# Jaskmoney OpenTUI Reconstruction Contract

> User-visible behavioural invariants derived from the legacy Go source under `legacy/go/`, its tests, and DeepWiki queries. Not a specification document. Evidence hierarchy: source > tests > DeepWiki findings > specs.
>
> Source file names in this document are relative to `legacy/go/`.

---

## 1. Product shape

Jaskmoney is a keyboard-first terminal (TUI) personal finance application built with Bubble Tea (Go). It runs in a full-terminal window with no mouse support.

**Four tabs**: Dashboard, Budget, Manager (transactions/accounts), Settings.

**Interaction model**: Keyboard navigation via cursor keys, vim-style movement (`j`/`k`), jump mode (`v` + target key), command palette (`Ctrl+K`), and colon mode (`:`). Persistent header (app name + tab bar), card-based content area with focused-section borders, single-line status bar, and single-line footer with scope-aware keybinding hints.

**Core financial concepts**: Transactions (debits/credits), accounts, categories (one per transaction), tags (many per transaction), transaction allocations (splitting a parent into child rows), budgets (per-category monthly targets), spending targets (saved-filter-based spending limits), rules (auto-categorisation on import/apply), saved filters (persisted filter expressions).

**Density**: Designed for experienced terminal users — shows maximum information per screen, uses colour badges, sparklines, bar charts, and compact tables.

---

## 2. Global interaction contract

### 2.1 Key precedence

When a `tea.KeyMsg` arrives, `model.Update` applies strict linear precedence:

1. **Overlay precedence loop** (`dispatch.go`: `dispatchOverlayKey` via `overlayPrecedence()`). Iterates entries in declaration order. First entry whose `guard(m)` returns `true` consumes the key. Entries in order: jump, command, detail, importPreview, filePicker, catPicker, tagPicker, quickOffset, filterApplyPicker, managerActionPicker, filterEdit, managerModal, dryRun, ruleEditor, filterInput. Only first match fires.

2. **Inline text editors** (`update.go`). If no overlay handled the key and any of `m.budgetEditing`, `m.dashCustomEditing`, or `m.filterInputMode` is active, the key routes directly to the owning tab's update function, bypassing the command system.

3. **Command binding** (`update.go`). `m.executeBoundCommand(m.commandContextScope(), msg)`. Looks up key in `KeyRegistry` for current context scope. If found and `Enabled()` returns true, executes the bound command.

4. **Tab-level handler**. Dispatches to `updateSettings` for settings tab, `updateMain` for all others.

5. **`updateMain` fallback**. Contains `actionQuit`, `actionTabSwitch`, and miscellaneous global navigation.

**Verified invariants**: Overlay always wins. Text input is next. Command binding is a routing layer, not a security boundary. `resilience_test.go` verifies overlay priority ordering.

### 2.2 Overlay rendering, active scope, footer hints, and command availability

Three consumers read the same `overlayPrecedence()` table: Update (key dispatch), footer bindings (footer hints), command context scope (command availability). The `forFooter` and `forCommandScope` flags on each `overlayEntry` let consumers skip irrelevant entries.

- `footerBindings()` calls `m.activeOverlayScope(true)`, skipping entries where `forFooter == false`.
- `commandContextScope()` calls `m.activeOverlayScope(false)`, skipping entries where `forCommandScope == false`.
- `activeInteractionContract()` calls `activeOverlayScope(true)` to find the scope, then looks up an `InteractionContract` in the `interactionContracts` map. `renderFooterFromContract()` uses this contract to generate `key.Binding` objects, resolving action→key via `primaryKeyForScopeAction()`.

**Verified invariants**: The dispatch table is the single source of truth. Every overlay must have one entry with correct flags for all three consumers. `TestDispatchTableOverlayGuardsAreMutuallyExclusiveWithTabs` verifies mutual exclusivity.

### 2.3 Commands

Commands are `Command` structs registered in `NewCommandRegistry()` (`commands.go`). Each has: ID, Label, Description, Category, Scopes array, `Enabled` function, `Execute` function. Commands are the preferred path for user-visible actions — anything that would appear in the command palette is a command. Direct handlers (in `update.go`, `update_detail.go`, `update_manager.go`) cover cursor movement, text input, contextual confirm/delete/quit, and procedural multi-step workflows (import dupe decision, detail notes dual-mode editing) that cannot be represented as single-command actions.

- **Command palette** (`Ctrl+K`): Shows all commands matching current scope. Disabled commands shown greyed-out with reason.
- **Colon mode** (`:`): Same search mechanism.
- **Scope filtering**: Commands only visible when current scope matches one of their `Scopes`.
- **Hidden commands**: `Hidden: true` excluded from palette but still executable via keybinding.

### 2.4 Footer contracts

`activeInteractionContract()` (dispatch.go:704) resolves the current scope via `activeOverlayScope(true)`, then looks up an `InteractionContract` from the `interactionContracts` map. `renderFooterFromContract()` (line 762) generates `key.Binding` objects by resolving actions→keys via `primaryKeyForScopeAction()`.

If an overlay is active but has no registered `InteractionContract`, a default empty contract is used (produces no footer hints).

### 2.5 Tab switching

Number-key tab switch (`1`–`4`) and `Tab`/`Shift+Tab` both call `applyTabDefaultsOnSwitch()` (`update.go`), which resets `managerMode`, `focusedSection`, `settActive` per tab.

| Property | Behaviour |
|---|---|
| Focus | Cleared (defaults per tab) |
| Cursor | Reset to 0 |
| Scroll | Reset to 0 |
| Filters | Preserved (input text, expression) |
| Selections | Preserved (selectedRows by ID) |
| Editors | Cleared |
| Dashboard timeframe | Persisted (dashTimeframe, dashPeriodAnchor) |

### 2.6 Jump mode

Activated by `v` key (`actionJumpMode`). Saves current `focusedSection` to `jumpPreviousFocus`. Renders floating badges for `jumpTargetsForActiveTab()`.

**Jump targets per tab**:
- Dashboard: `d`=Date Range, `n`=Net/Cashflow, `c`=Composition
- Budget: `t`=Budget Table, `p`=Planner
- Manager: `a`=Accounts, `t`=Transactions
- Settings: `c`=Categories, `t`=Tags, `r`=Rules, `f`=Filters, `d`=Database, `w`=Chart Views

On target keypress: sets `focusedSection` to target, calls `applyFocusedSection()` to set tab-specific state, deactivates jump mode. `Esc` or `v` again restores `jumpPreviousFocus`. Key `v` is reserved from being a target key via `filterReservedJumpTargetKeys`. If `drillReturn` is active when jump mode activates, it is cleared.

### 2.7 Focus, cursor, selection, range

**Five distinct states**:

1. **Table cursor** (`m.cursor`): row index into `filtered`. Moved by `j`/`k`, `Up`/`Down`, `Ctrl+P`/`Ctrl+N`. Persists across modal open/close. Invalidated on filter/sort (reset to 0). Stored as integer index.

2. **Selected transaction rows** (`m.selectedRows`): map of `int64→bool` keyed by transaction ID. Entered via `Space` on cursor row or `Space` while range highlighted. Persists across modals, filtering, sorting (tracked by ID, not index). Cleared by `txn:clear-selection` (key `u`). **Esc does NOT clear selections** in transactions mode.

3. **Range highlighting** (`m.rangeSelecting`, `m.rangeAnchorID`, `m.rangeCursorID`): entered by `Shift+Up`/`Shift+Down`. Cleared when a modal opens. Persists across filter/sort via ID-based resolution (`indexInFiltered`).

4. **Card focus** (`m.focusedSection`): used for Dashboard analytics panes, Budget sections, Manager accounts/transactions, Settings columns. Entered by jump mode, direct tab-level focus, or card activation. Persists until explicit unfocus (`Esc`), tab switch, or jump mode cancel.

5. **Card selection**: Not a distinct implemented concept.

**Selection precedence for quick actions** (`quickActionTargets` in `update_transactions.go`):
1. Highlighted range (if active)
2. Explicitly selected rows
3. Cursor row (fallback)

After target IDs are obtained, `splitRowTargets()` separates into `txnIDs` (positive) and `allocationIDs` (negative).

### 2.8 State preservation/clearing per navigation path

| Path | Focus | Cursor | Scroll | Filters | Selections | Editors | Date |
|---|---|---|---|---|---|---|---|
| Tab switch (number key or Tab) | Cleared (defaults per tab) | Reset to 0 | Reset to 0 | Preserved | Preserved | Cleared | Persisted |
| Jump mode (`v`) | Saved to `jumpPreviousFocus`, restored on cancel | Preserved | Preserved | Preserved | Preserved | Cleared if activating budget section | Persisted |
| Dashboard drill-down | Dashboard state saved in `drillReturn`, replaced with Manager focus | Reset (Manager) | Reset | Replaced with drill filter | Preserved | Cleared | Saved in drillReturn |
| Dashboard return (Esc) | Restored from `drillReturn` | Restored | Restored | Restored to pre-drill values | Preserved | Restored | Restored |
| Manager mode change | Updated to match new mode | Preserved | Preserved | Preserved | Preserved | Cleared | Persisted |
| Esc (general) | Depends on context | Preserved | Preserved | Clears filter input if in filter mode | Not affected | Cleared if active | Preserved |

### 2.9 Universal key semantics

| Key | Universal meaning | Exceptions |
|---|---|---|
| `Enter` | Confirm / Select / Activate | Quick tag picker with pending changes: applies dirty. Rule editor tag picker, no pending: toggles AND closes. Detail modal notes editing: `Enter` exits edit mode. |
| `Esc` | Cancel / Back / Close | Filter input: clears filter text, resets cursor. Account mode: switches to transactions. Jump mode: cancels to previous focus. Settings active mode: returns to navigation. **Transactions mode: not bound — no-op** (Esc not bound in `scopeTransactions`). |
| `Space` | Toggle selection | Tag picker: toggles checkbox. Command palette: no-op (Bubble Tea defaults). Filter input: literal space. |
| `Delete` | Delete current item | Only active in list/edit contexts with a delete action. No-op when nothing deletable is focused. |
| `Tab` | Next field / Next focusable | Multi-field modal forms: cycles fields. Settings navigation: switches columns. |
| Printable text | Literal text input | In non-text contexts: `v` triggers jump mode, `:` triggers colon mode, `/` opens filter. Vim-navigation scopes: `j`/`k` move cursor. |

### 2.10 Text input safety

`modalTextContracts` in `dispatch.go` defines which scopes suppress vim navigation. Any new text-input scope must be registered here. Printable keys are literal text in text-input contexts.

---

## 3. Screens

### 3.1 Dashboard

**Layout** (top to bottom):

**Date Range pane** (top, focusable, jump key `d`): timeframe controls with preset chips from two families, selected via `dashPresetActive`:
- **Lookback presets** (`dashPresetLookback`): 1M, 2M, 3M, 6M, 1Y. Maps to a `dashTimeframe` constant used by `timeframeBounds()`.
- **Period presets** (`dashPresetPeriod`): Month, QTR, Half, FY, Year. Active period tracked by `dashPeriodActive` (enum `dashPeriodType`) and `dashPeriodAnchor` (YYYY-MM-DD start date). Uses `periodEndExclusive()` for bounds.
- **Custom** (`dashPresetCustom`): Manual start/end editing via `dashCustomStart`/`dashCustomEnd`/`dashCustomInput`. `dashCustomEditing = true` activates custom input mode.
- Preset chips rendered as `[label]` with bold accent for the active preset. Cursor shown as `> ` when `dashTimeframeFocus` is true. Horizontal navigation via `h`/`l`.
- `dashAnchorMonth` and `dashMonthMode` provide an alternative month-anchored timeframe path.

**Data source**: `dashboardTimeframeBounds(now)` returns `(start, endExcl, ok)`. Falls through: lookback → `timeframeBounds(timeframe)`, period → `periodEndExclusive(start)`, custom → `timeframeBounds(custom)`.

---

**Overview strip** (non-focusable, rendered by `renderSummaryCards`): Four rows in two-column layout:

| Left column | Right column |
|---|---|
| Balance (green if ≥0, red if <0) | Uncat count + total |
| Debits (red) | Transaction count |
| Credits (green) | Daily burn (warn-coloured) |
| Savings rate % | Runway (days) |

**Data source**: Scans `m.getDashboardRows()` — all transactions matching the dashboard scope filter (account scope AND-composed with date range). Computes balance, income, expenses, uncategorised count/total, date span for daily burn calculation. Does NOT exclude IGNORE-tagged rows — that filter is applied by `dashboardSpendRows` which only affects the spending tracker and composition panes.

---

**Spending Tracker** (non-focusable, rendered by `renderSpendingTrackerWithRange`): Braille line chart of daily spend. Shows the last `spendingTrackerDays` (60) by default; when a dashboard timeframe is active the chart spans `start..end` from `dashboardChartRange()`.

**Data**: `dashboardSpendRows(rows, txnTags)` — filters out IGNORE-tagged transactions, aggregates spend via `aggregateDailySpendForRange()` (sums negative amounts per day, credits excluded). Returns `([]float64, []time.Time)`.

**Chart rendering** (`renderTimeSeriesWithRange`): Uses the `tslc` library (terminal sparkline line chart). Braille drawing. Height = `spendingTrackerHeight` (14). Y-axis auto-scaled via `spendingYScale()` / `signedYScale()`. X-axis labels and vertical gridlines controlled by the `spendingAxisPlan` built in `planSpendingAxes()`.

**Gridline system** (`drawVerticalGridlines`, `buildGridlineColumns`): Four kinds of vertical gridlines drawn as `│` characters in the graphing area (between top of graph and axis row):

| Kind | Colour | Condition |
|---|---|---|
| Year boundary | `colorAccent` (pink) | December 31 + January 1 of any year |
| Month boundary | `colorBlue` | Last day of month (`isMonthEnd`: `d.Day() == daysInMonth(d)`) + first day of month if not already year |
| Week marker | `colorSurface1` (subtle) | Density-dependent: `isMonthWeekMajorMarker` selects which days-of-month (7/14/21) get lines based on `monthWeekDensityForRange()` |
| Today marker | `colorSuccess` (green) | Current date, if within chart range, drawn last (overwrites previous) |

**Week density** (`monthWeekDensityForRange`): Three tiers based on columns-per-month in the chart:
- `monthWeekDensityWeekly` (≥14 cols/month): lines at day 7, 14, 21
- `monthWeekDensityShoulder` (≥9 cols/month): lines at day 7, 21
- `monthWeekDensityFortnight` (<9 cols/month): line at day 14 only

**`monthWeekMarkerColumnX()`**: Normalises week-marker column positions to a 31-day scale so day 14 and 21 markers don't jump between 28/30/31-day months, while preserving exact start/end boundary columns. Formula: `startX + round((day-1)/30.0 * span)`.

**Week anchor** (`spendingWeekAnchor`): Controls week boundary day (Sunday/Monday), toggleable from Settings > Chart Views via `h`/`l`. **Not used in gridline rendering** — `buildGridlineColumns` has `_ = weekAnchor`. The gridline system uses calendar-month boundaries and fixed day-of-month week markers, not weekday-anchored week boundaries. The week-anchor parameter is passed through the chart rendering chain (it feeds the Budget period and some axis-plan functions) but does not affect Spending Tracker vertical gridlines.

**X-axis labels** (`spendingXLabelsWithColumns`): Three priority tiers for label placement:
1. **Year boundaries** (Dec 31): label = next year number ("2025")
2. **Month boundaries** (last day): label = next month name ("Jan", "Feb" — with year suffix if January)
3. **Week markers** (day 7/14/21): label = day number ("14")
4. **Start/end labels**: always shown if space permits (label format: "2 Jan" same-year, "2 Jan 25" cross-year)

Labels placed greedily by priority via `canPlaceXLabel` with `minXLabelGapForDays`: 3 chars for ≤240 days, 2 chars beyond. Month/year labels use `monthBoundaryLabel`/`yearBoundaryLabel` which label the *next* period (the label at Dec 31 reads "2025", not "2024").

**Boundary label formats**: `boundaryLabel(d, other)` = "2 Jan" same-year, "2 Jan 25" cross-year. `monthBoundaryLabel(d)` = "Jan" (+"25" if transitioning to January). `yearBoundaryLabel(d)` = next year number.

---

**Spending by Category** (non-focusable, rendered by `renderCategoryBreakdown`): Horizontal bar chart of spending per category. Uses `spendRows` (IGNORE-filtered). All known categories shown, sorted by spend descending, with colour swatch. Uncategorised always included last. Uses `renderMiniMeter` bars.

---

**Lower analytics** (two focusable panes, rendered by `renderDashboardAnalyticsRegion`):

When width ≥80: side-by-side in 60:40 split (`dashboardAnalyticsPaneWidths`). When <80: stacked vertically. Both panes use computed height: `max(spendingTrackerHeight, (height * 40) / 100)`.

**Net/Cashflow pane** (60% width, jump key `n`, title "Cashflow"): Three built-in modes plus any custom modes from `config.toml` `[[dashboard_view]]` blocks:

| Mode ID | Data | Rendering |
|---|---|---|
| `net_worth` | `aggregateDailyNetForRange` → `cumulativeSeries` (daily net accumulated) | Braille line chart via `renderNetWorthTrackerWithRange`. Signed Y-axis (positive/negative). Horizontal zero line at y=0 (`drawHorizontalValueLine`). |
| `spending` | `aggregateDailySpendForRange` (daily spend, IGNORE-filtered) | Braille line chart via `renderSpendingTrackerWithRangeSized`. Identical rendering pipeline to the standalone Spending Tracker above — same `planSpendingAxes`, same gridline system, same `monthWeekDensityForRange`/`drawVerticalGridlines`/`spendingXLabelsWithColumns`. |
| `spend_vs_budget_pace` | `aggregateDailySpendForRange` (actual) + `cumulativeBudgetPaceSeries` (budget) | Dual braille line chart via `renderDualTimeSeriesWithRange`. Two series overlaid on same Y-axis. |
| Custom modes | `filteredRows` with AND-composed `buildDashboardModeFilter` (account scope + date range + custom `filterExpr`) | Uses primary view type; all custom modes render through the Net/Cashflow path. |

**Spending Tracker vs Cashflow > Spending relationship**: Both use `renderSpendingTrackerWithRangeSized` → `renderTimeSeriesWithRange` — identical rendering pipeline. The standalone tracker defaults to the last 60 days (`spendingTrackerDays`). Cashflow > Spending uses the active dashboard timeframe. The chart rendering (gridline marker density, axis labels, week density) is computed independently for each based on their date range, so the two can differ. The week-anchor parameter is passed through both paths but unused in gridlines (`_ = weekAnchor` in `buildGridlineColumns`).

**Composition pane** (40% width, jump key `c`, title "Composition"): Three built-in modes:

| Mode ID | Data | Rendering |
|---|---|---|
| `category_share` | `dashboardSpendRows` (IGNORE-filtered) | Horizontal bar chart via `renderCategoryBreakdown`. Categories sorted by spend descending, colour swatch, Uncategorised last. |
| `needs_wants_savings` | Same data, bucketed by category rules into Needs/Wants/Savings | Horizontal bar chart with three bars. |
| `top_merchants` | `dashboardSpendRows` grouped by payee description | Top N merchants by spend via `renderDashboardTopMerchants`. |

---

**Narrow fallback** (<80 cols): lower analytics panes stack vertically instead of side-by-side.

**Drill-down**: From a focused analytics pane, Enter composes a drill predicate (widget-specific expression AND-composed with dashboard scope filter), replaces the Manager filter, switches to Manager tab. Only Esc from Manager returns to Dashboard (any other navigation cancels the drill).

**State preserved**: active timeframe, date range, focused pane, widget modes, scroll position. `drillReturn` is cleared on any non-Esc navigation away from Manager.

**Custom dashboard modes**: Defined in `config.toml` under `[[dashboard_view]]` blocks. A `customPaneMode` can specify `viewType` (line/area/bar/pie/table) and `filterExpr`. Custom slots are active only for the `net_cashflow` pane. Active custom modes filter dashboard data with an AND composition of `buildDashboardScopeFilter()` and the custom mode's `filterExpr`.

### 3.2 Budget

**Two views**, toggled by `w` key (`budget:toggle-view`):

**Table view** (`budgetView=0`, default, jump key `t`):
- Category Budgets pane: table rows with columns for budgeted, spent, remaining.
- Spending Targets pane: target rows referencing saved filters, with period (monthly/quarterly/annual) and overridden amounts.
- Compare Bars (wide strip): budget_vs_actual, income_vs_expense, month_over_month.
- Analytics strip: adherence %, over-budget count, MoM change.
- **Editing**: `Enter` opens inline edit. `Enter` again saves (calls `upsertCategoryBudget` for default amount). `Esc` cancels.
- **Cursor**: `j`/`k` moves vertically through category budget rows, then into spending-target rows below the category budgets.
- **Spending target actions**:
  - **Add** (`a`, `budget:add-target`): Opens a saved-filter picker modal. After selecting a saved filter, the target is created with an initial name and amount (default empty). The target appears in the Spending Targets pane.
  - **Edit**: `Enter` on a target row opens an inline editor for the target amount. `Enter` saves, `Esc` cancels. The period and saved-filter reference are set at creation and cannot be changed via the inline editor.
  - **Delete** (`del`, `budget:delete-target`): Two-key confirmation (press `del` again within ~2s). Confirmed: `deleteSpendingTarget` removes the target and cascades to its overrides (ON DELETE CASCADE).

**Planner view** (`budgetView=1`, jump key `p`):
- **Grid rendering** (`renderBudgetPlannerGrid`): Column layout — `catW = 16` for category name (with `●` colour swatch), `monthW = 7` for each of 12 month columns. Separator between columns: single space.
- **Header row**: Category header + 12 month abbreviations (Jan–Dec) in `tableHeaderStyle`.
- **Row rendering**: For each `budgetLine` (category budget):
  - `●` colour swatch (default `colorOverlay1`, coloured if category has non-default colour) + category name.
  - 12 month cells: default amount shown in `colorSubtext0`, override amounts in `colorWarning` with `*` suffix, cursor cell in `colorAccent` + bold.
  - Row background: `colorSurface2` + bold on cursor row.
  - Inline edit indicator: when `m.budgetEditing` is true on cursor row, shows `[┆editValue]` in accent bold.
  - Row filled to full width with space-padded background.
- **Navigation**: `h`/`l` moves `m.budgetPlannerCol` (0-11, month index). `j`/`k` moves `m.budgetCursor` (row index) through budget lines. Month/year wraps at boundaries within the current year.
- **Month/year stepping**: `budget:prev-month`/`budget:next-month` (month steps), `budget:prev-year`/`budget:next-year` (year steps, resets to January). `actionTimeframeThisMonth` resets to current month.
- **Editing**: `Enter` on a cursor cell opens inline edit in the amount field. `Enter` again saves an override via `upsertBudgetOverride`. `Esc` exits edit without saving. Override amounts shown with trailing `*` asterisk (not on cursor cell).
- **Override-aware display**: For each cell, the displayed amount is either the default budget amount or the override amount (looked up via `budgetOverrideAmount(overrides, fmt.Sprintf("%04d-%02d", year, month))`). Cursor cells that are overridden show the override value directly without the `*` suffix (the `*` appears only on non-cursor override cells).
- **Reset override**: `budget:reset-override` removes the month-specific override for the cursor cell, reverting to default.

**Compare Bars** (wide strip below planner/table): `renderBudgetVarianceSparkline` renders 6-level unicode block sparkline (▁▂▃▄▆█) representing budget_vs_actual variance. Also shows income_vs_expense and month_over_month as compact metric lines.

**Analytics strip**: Shows adherence % (budgeted vs actual), over-budget count (categories exceeding budget), and month-over-month change percentage.

**Shared state**: Month/year syncs with Dashboard month anchor state (`m.budgetMonth`, `m.budgetYear`). Budget specific state: `m.budgetView`, `m.budgetCursor`, `m.budgetPlannerCol`, `m.budgetEditing`, `m.budgetEditValue`.

**Category budget calculation** (`computeBudgetLines`):
1. Load default monthly budget from `category_budgets`.
2. If `category_budget_overrides` exists for target month, use override amount.
3. Calculate total spent via `queryEffectiveSpendByCategory` — includes both full transactions and allocation rows.
4. Remaining = budgeted - spent. Over-budget if remaining < 0.

**Spending target calculation** (`computeTargetLines`):
1. Load `spending_targets` with `saved_filter_id`, `name`, `amount`, `periodType`.
2. Apply `spending_target_overrides` if exist for the period.
3. Compute "effective rows" including both original transactions and child allocations.
4. Evaluate each effective row against the target's filter expression and sum debits.
5. Remaining = target amount - spent. Over-target if remaining < 0.

**Allocation-aware effective spend**:
- Parent remainder: `fullAmount - SUM(allocations)`.
- Combine allocated amounts and parent remainders into "effective rows".
- Sum negative amounts (expenses) grouped by category.
- Double-counting prevented: transaction counted as full (no allocations), sum of allocations (fully allocated), or remainder + allocations (partially allocated) — never both.

### 3.3 Manager

**Two sections**, switched by jump mode or Esc:

**Accounts strip** (top, focusable via jump key `a` or `managerModeAccounts`):
- Horizontal account list with selection toggles.
- Selecting/deselecting updates `m.filterAccounts`.
- Toggle via `Space`, Enter, or account action picker.
- Persisted via `persistManagerAccountScopeCmd`.
- "All accounts" when `m.filterAccounts == nil` (initial state). When all accounts are toggled on, resets to nil.
- `Esc` from accounts mode returns to transactions mode.

**Account editing modal**: Opened via account action picker. `Enter` on selected account opens `managerModal` for rename/delete. Delete of last account blocked (at least one account required).

**Transactions table** (main section, focusable via jump key `t` or `managerModeTransactions`):

**Column layout** (`renderTransactionTable`): Fixed widths computed before any rows are drawn:
- Date: 9 chars (format `dd-mmm-yy`, e.g. `15-Jan-24`, left-padded with spaces).
- Amount: 18 chars (right-aligned via left-padding). Credit = green (`colorSuccess`), debit = red (`colorError`). If allocation remainder annotation exists, appends ` [fullAmount]` inside the 18-char budget.
- Description: target 40 chars, shrinks to fill available width (`descTargetW = 40`, minimum 5). Truncated via `truncateTxnDescription` (n-2 visible chars + `…` ellipsis).
- Category: 14 chars (coloured badge if non-default colour, else `colorOverlay1`). Only renders if categories exist.
- Account: 10 chars. Only renders if multiple distinct account names appear in the row set (`hasMultipleAccountNames`).
- Tags: occupies remaining width after all other columns and separators. Only renders if categories exist (tags implied).
- Separator: single space between each column.

When tags column is present, it absorbs all leftover width: `tagsW = width - fixedWithoutTags - descW`. Fixed minimum of 1 char.

**Sort indicators** (`addSortIndicator`): Header column labels append ` ▲` (ascending) or ` ▼` (descending) for the active sort column. Sort columns (iota): 0=Date, 1=Amount, 2=Category, 3=Description. `sortColumnCount = 4` guards bounds.

**Scrolling**: Controlled by `m.topIndex` (first visible row index) and `m.visibleRows()` (computed from container height). Cursor movement adjusts `topIndex`:
- If cursor moves above `topIndex`, `topIndex = cursor`.
- If cursor moves below `topIndex + visible - 1`, `topIndex = cursor - visible + 1`.
- On sort change or filter change, both `cursor` and `topIndex` reset to 0.
- A scroll indicator footer line renders when rows exist: `── showing 1-20 of 100 (20) ──` styled with `scrollStyle` (`colorOverlay1`). Shows 1-based `start` and `end` indices, total count, and `shown` count.

**Cursor highlighting** (`rowStateBackgroundAndCursor`): Three boolean flags (isCursor, selected, highlighted) combine into a 9-case priority switch:

| Cursor? | Selected? | Highlighted? | Background colour | Bold? |
|---------|-----------|--------------|-------------------|-------|
| Yes | Yes | Yes | `colorAccent` | Yes |
| Yes | Yes | No | `colorBlue` | Yes |
| Yes | No | Yes | `colorSapphire` | Yes |
| Yes | No | No | `colorSurface2` | Yes |
| No | Yes | Yes | `colorSurface1` | No |
| No | Yes | No | `colorSurface0` | No |
| No | No | Yes | `colorMantle` | No |
| No | No | No | `""` (inherit) | No |

The cursor+selected+highlighted case (top priority) occurs when cursor lands on a row that's in the middle of a highlighted range and already selected. Category/tag cells use `renderCategoryTagOnBackground`/`renderTagsOnBackground` which accept the background colour and bold flag so they blend with the row colour.

**Selections** (`m.selectedRows`): `map[int64]bool` keyed by transaction ID. Entered via `Space` on cursor row, or `Space` while range highlighted (bulk toggle). Persists across modal open/close, filtering, and sorting. Cleared by `txn:clear-selection` (key `u`). **Esc does NOT clear selections**. When `Space` is pressed while range is active, `toggleSelectionForHighlighted` checks if ALL highlighted rows are selected (bulk deselect) or any are unselected (bulk select). Selection anchor (`m.selectionAnchor`) set to cursor row's ID.

**Range highlighting** (`m.rangeSelecting`, `m.rangeAnchorID`, `m.rangeCursorID`): Entered by `Shift+Up`/`Shift+Down`. On first use, sets both `rangeAnchorID` and `rangeCursorID` to the current cursor row's ID. Subsequent moves update `rangeCursorID` only. `highlightedRows()` computes the inclusive range between anchor and cursor by resolving both back to indices via `indexInFiltered()`. Range cleared when any modal opens, or by normal cursor movement (single delta). Persists across filter/sort via ID-based resolution: `ensureRangeSelectionValid` re-resolves anchor/cursor IDs against the new filtered set, clearing if either ID is missing.

**Keyboard shortcuts in transactions scope**:

| Key | Action | Effect |
|-----|--------|--------|
| `j`/`k`, `Up`/`Down` | `actionUp`/`actionDown` | Move cursor 1 row, clamp to bounds. Scroll follows. |
| `Shift+Up`/`Shift+Down` | `actionRangeHighlight` | Move cursor and extend/begin range highlight |
| `g` | `actionJumpTop` → `txn:jump-top` | Cursor to 0, `topIndex` to 0. Clears range. |
| `G` | `actionJumpBottom` → `txn:jump-bottom` | Cursor to last row, scroll to show at bottom. Clears range. |
| `s` | `actionSort` → `txn:sort` | Cycle sort column (Date→Amount→Category→Description→Date). Resets cursor/topIndex. |
| `S` | `actionSortDirection` → `txn:sort-dir` | Toggle sort direction. Resets cursor/topIndex. |
| `Space` | `actionToggleSelect` → `txn:select` | Toggle selection (single row, or bulk if range active) |
| `u` | `actionCommandClearSelection` → `txn:clear-selection` | Clear all selections |
| `c` | — (handler) | Quick category picker on range/selection/cursor |
| `t` | — (handler) | Quick tag picker on range/selection/cursor |
| `Enter` | — (handler) | Open transaction detail modal |
| `delete` | — (handler) | Delete cursor transaction (no batch) |
| `/` | — (handler) | Enter filter input mode |

**Allocation child rows**: Interleaved with parents in `filtered` rows. `isAllocation = true` flag on the row struct. Rendered with `↳   ` prefix (styled in `colorOverlay1`) before the row columns. Parent rows show remainder amount; the detail modal displays the original `fullAmount` in brackets when the displayed amount differs from full.

**Background fill**: Every row line is extended to the full table width with space-padded background cells (`strings.Repeat(" ", width-ansi.StringWidth(line))`), ensuring no bare-terminal-background gaps at column boundary.

**Filtering** (`/` key):
- Opens `filterInputMode`. Permissive parsing for interactive input.
- `Enter` applies filter (uses `parseFilterStrict` for `filterLastApplied`).
- `Esc` with filter active: clears filter text (if `drillReturn` active, returns to Dashboard).
- Filter input preserved across tab switches.
- Account scope AND-composed with filter.

**Keyboard shortcuts** in transactions scope: see table above under Transactions table → "Keyboard shortcuts in transactions scope".

**Transaction detail modal** (`Enter` on a row, `renderDetailCore`):

**Modal dimensions**: Fixed width 52 (`detailModalWidth`). Text wrap column 40 (`detailTextWrap`). Title: "Transaction Details" (or "Allocation Details" if `txn.isAllocation`).

**Rendering layout** (top to bottom):
1. **Date + Amount line**: `detailLabelStyle` for labels, `detailValueStyle` for values. Amount coloured: green (`creditStyle`) if > 0, red (`debitStyle`) if < 0.
2. **Original amount note**: If the displayed amount differs from `fullAmount` (allocation remainder), shows "Original: [fullAmount]" in `detailLabelStyle`.
3. **Parent txn link** (allocation rows): Shows "Parent txn: #[id]".
4. **Category**: In category colour if non-default, else `detailValueStyle`. "Uncategorised" if empty.
5. **Tags**: Joined with spaces, wrapped at 40 chars. Indented continuation lines.
6. **Description**: Wrapped at 40 chars. Separated by blank line.
7. **Allocations list** (parent transactions only): Each allocation shown with `↳` prefix, amount coloured (green/red), category name, tags (if any), note (if any, truncated to 32 chars). Separated by blank line.
8. **Notes**:
   - **View mode**: Shows note text wrapped at 40 chars. If empty, shows "(empty - press n to edit)". Footer shows keybinding hints.
   - **Edit mode** (`m.detailEditing == "notes"`): `n` toggles edit mode. Notes rendered with visible cursor (`renderASCIIInputCursor`). `Enter` saves via `updateTransactionNotes` (or `updateTransactionAllocationNote` for allocation rows). `j`/`k`/`Up`/`Down` move cursor within note text. `Esc` exits edit mode (not the modal). When in edit mode, footer shows "enter done  esc close".

**Category picker** (`c`): Opens single-select category picker. `Enter` selects, `Esc` cancels. Category assigned via `applyCategoryToRowTargets`.

**Tag picker** (`t`): Opens multi-select tag picker with tri-state checkboxes. Sectioned into Scoped/Global/Unscoped. See tag picker section for Enter dispatch.

**Allocation editing** (`o`, bound to `txn:edit-allocations`): Opens allocation amount modal (`allocationModalOpen`). If cursor row is an allocation, pre-fills amount and note for editing. If parent transaction and no allocation selected, opens in create mode with empty fields.

**Allocation creation**: Same `txn:edit-allocations` on parent row. Modal opens with empty amount + note. Enter creates via `insertTransactionAllocation` — validates allocation capacity (remaining amount must be non-zero). See section 4.2 for capacity semantics.

**Closing**: `Esc` (`actionClose`) or `q` (`actionQuit`). Esc in notes edit mode exits edit mode first; second Esc closes modal.

**State model**: Controlled by `m.showDetail` (bool), `m.detailRow` (transaction), `m.detailRowValid` (bool), `m.detailEditing` ("" or "notes"), `m.detailNotes` (string), `m.detailNotesCursor` (int). All cleared on close via `closeDetail`.

**Quick category assignment** (`c` key in transactions mode):
- Resolves targets via `quickActionTargets()` (range > selection > cursor).
- Opens category picker (single-select, no checkboxes).
- `Enter` on category applies to all targets via `applyCategoryToRowTargets`.
- Category replaces (last writer wins). Allocation targets get their own category via `updateTransactionAllocationCategory`.

**Quick tag assignment** (`t` key in transactions mode):
- Resolves targets via `quickActionTargets()`.
- Opens tag picker (multi-select with tri-state checkboxes).
- Tags sectioned into "Scoped" (associated with targets' categories), "Global", "Unscoped".
- Initial state per tag: None, Some, or All across targets.
- `Space` toggles individual tag. `Enter` applies dirty changes (additions + removals) to DB.
- Supports inline creation of new global tags.
- Tag assignment to allocation rows blocked for multi-allocation-row operations.

**Tag picker Enter behaviour** (four paths):
1. **Rule editor, no pending changes**: toggles focused tag + closes (no DB write).
2. **Regular picker, no pending changes**: toggles tag + applies to DB immediately + closes.
3. **Either context, pending changes**: applies all dirty changes (addIDs + removeIDs) to DB + closes.
4. **Multi-select submit** (`HandleMsg` → `pickerActionSubmitted`): sets all selected tags (single row) or adds them (multi-row) to DB + closes.

**Selected rows and range**: Persist across modal open/close. Range cleared on modal open. Esc does not clear selections. `u` clears all selections (`txn:clear-selection`).

**Refresh**: After any mutation, `refreshCmd(m.db)` reloads rows, categories, rules, tags, txnTags, imports, accounts, selectedAccounts, info, filterUsage.

**Delete transaction**: `delete` key on cursor row (no batch delete). No confirmation for single transaction delete.

**File picker overlay** (`m.importPicking`, `m.importFiles`, `m.importCursor`): Opened via `import:pick` command. Shows a simple list of CSV files found in `m.basePath`. Each file displayed with cursor prefix (`> ` on cursor row, rendered in `cursorStyle`). Empty state: "Loading CSV files..." in `colorOverlay1`. Footer: "enter select  esc cancel".

Navigation: `j`/`k` move cursor (`moveBoundedCursor`). `Enter` (`actionSelect`) picks the cursor file: closes file picker, sets status "Scanning for duplicates...", dispatches `scanDupesCmd` to build an `importPreviewSnapshot`. `Esc` (`actionClose`) closes file picker without action. `Ctrl+C` (`actionQuit`) quits app.

After scan completes, `importPreviewOpen` becomes true and the import preview overlay renders. The file picker overlay precedence is above importPreview in `overlayPrecedence()` so file picker surfaces before the preview.

### 3.4 Settings

**Two-column layout**:
- **Left column**: Categories (row 0), Tags (row 1), Rules (row 2), Saved Filters (row 3).
- **Right column**: Chart Views (row 0), Database & Import (row 1), Import History (row 2).

**Navigation mode** (`settActive=false`, default): `j`/`k` move between sections, `h`/`l` switch columns, `Enter` activates section.

**Active mode** (`settActive=true`): Section-specific editor. `Esc` returns to navigation mode. Jump targets also set `settActive=true` directly and reset `settItemCursor` to 0.

**State fields**: `settColumn` (0=left, 1=right), `settSection` (category constant), `settActive` (bool), `settItemCursor` (int), `settMode` (add/edit/etc).

**State preservation**: `settActive` cleared on leaving Settings tab. `settColumn`/`settSection` reset on tab switch.

#### 3.4.1 Categories

- **List rendering**: Colour swatch (■) + name. Default categories marked "(default)". Cursor shown with `> ` prefix when active. Empty state: "No categories."
- **Add** (`a`): Opens name/colour editor in `settModeAddCat`.
- **Edit** (`Enter` on a category): Pre-fills editor in `settModeEditCat`.
- **Name/colour editor**: `Tab`/`Shift+Tab` switches between two fields tracked by `settCatFocus`: 0=name, 1=colour swatch. When name field is focused, printable keys type into name. When colour field is focused, `h`/`l` cycle through the palette via `settColorIdx = (settColorIdx ± 1) % len(palette)`. Colour swatches rendered as `■` with bold `[■]` for the selected index. `Enter` saves, `Esc` cancels. On edit of existing category, `categoryColorIndex(hex)` maps the stored colour back to the palette position to initialise `settColorIdx`.
- **Delete** (`del`): Two-key confirmation (press `del` again within ~2s). Confirmed: `deleteCategory` → sets `category_id` to NULL on affected transactions (ON DELETE SET NULL), sets scoped tags' `category_id` to NULL. **Protected**: "Uncategorised" (isDefault) cannot be deleted.
- **Save**: Calls `insertCategory` or `updateCategory`. On success dispatches `categorySavedMsg`, refreshes list.
- **Effects on**: Transactions (category nulled on delete — ON DELETE SET NULL), tags scoped to category (set to global — ON DELETE SET NULL), rules' `set_category_id` (set to NULL — ON DELETE SET NULL; rule still exists with no category action), category budgets (cascade-deleted — ON DELETE CASCADE), allocations' `category_id` (set to NULL — ON DELETE SET NULL).

#### 3.4.2 Tags

- **List rendering**: Colour swatch + name. Scoped tags show "(Scoped: CategoryName)". Cursor shown when active. Empty state: "No tags."
- **Add** (`a`): Opens name/colour/scope editor.
- **Edit** (`Enter` on a tag): Pre-fills editor.
- **Name/colour/scope editor**: `Tab`/`Shift+Tab` cycles through three fields tracked by `settTagFocus`: 0=name, 1=colour swatch, 2=scope. Colour cycling via `h`/`l` through the tag palette via `settColorIdx`. On edit, `tagColorIndex(hex)` maps the stored colour back to the palette position. Scope cycling via `h`/`l` iterates "Global" + each available category. `settTagScopeID = 0` means global; any non-zero value is a `categories.id` reference.
- **Delete** (`del`): Two-key confirmation. **Protected**: The mandatory `IGNORE` tag (used for rules) cannot be deleted. Delete cascades to `transaction_tags` and `transaction_allocation_tags` (ON DELETE CASCADE).
- **Effects on**: Transaction tags (cascade delete — ON DELETE CASCADE), allocation tags (cascade delete — ON DELETE CASCADE), rules with `add_tag_ids` (stale numeric ID reference in the JSON array; no FK constraint, silently skipped during rule application). Filter matching by `tag:` field is unaffected because filter expressions match by tag name (case-insensitive), not by ID — a deleted tag's name no longer exists to match.
- **Save**: `insertTag`/`updateTag`. Normalises name to uppercase. Unique constraint on name.

#### 3.4.3 Rules

- **List rendering**: Rule name, enabled indicator (✓/✗), saved-filter reference, reorder handles.
- **Add** (`a`): Opens multi-step rule editor modal.
- **Edit** (`Enter` on a rule): Pre-fills rule editor.
- **Rule editor** (modal with steps): Name → Saved Filter picker → Set Category picker → Add Tags picker → Enabled toggle. `Tab`/`Shift+Tab` cycles steps.
- **Enable/disable toggle**: `Space` in list view. In rule editor, toggle via action key.
- **Reorder**: `K` (move up) / `J` (move down) in list view. Updates `sortOrder`.
- **Save**: Validates saved filter is present and parseable. Inserts/updates `rules_v2`.
- **Cancel** (`Esc`): Closes editor, discards changes.
- **Delete** (`del`): Two-key confirmation. Removes from `rules_v2`.
- **Apply** (`A`): `rules:apply` — executes all enabled rules against transactions in current account scope. Single DB transaction. Returns summary counts.
- **Dry Run** (`D`): `rules:dry-run` — same evaluation pipeline as Apply but read-only (works on in-memory copies).
- **Scope label**: Shows "All Accounts" or "N selected".
- **Dry Run result modal**: Shows scope label, total modified, category changes, tag changes, failed rules, per-rule results (name, enabled, filter, match count, sample transactions).
- **Effects on**: Transactions (category set, tags added). All rules in a single DB transaction — full rollback on error.

#### 3.4.4 Saved Filters

- **List rendering**: Filter ID + name + truncated expression. Cursor shown when active. Invalid filters shown with red indicator.
- **Add** (`a`): Opens filter editor modal. Generates auto-ID like `filter-1`.
- **Edit** (`Enter` on a filter): Pre-fills editor with ID, name, expression.
- **Filter editor** (modal): Three fields — ID, Name, Expression. `Tab`/`Shift+Tab` cycles fields. ID is a text identifier (not numeric), used as reference key.
- **Validation**: `parseFilterStrict` validates expression on save. Blocks save if invalid. Match count shown in real-time if expression valid.
- **Rename/ID change**: Changing the ID is effectively a rename. Duplicate ID blocked. Old ID is replaced — references from rules/targets become stale.
- **Save**: Writes to `config.toml`. Invalid expressions at startup are skipped with a warning.
- **Cancel** (`Esc`): Discards changes.
- **Delete** (`D`): Two-key confirmation. Removes from `savedFilters` list, persists to `config.toml`. Stale references remain in rules/targets (no cascade).
- **Effects on**: Rules (stale `saved_filter_id` → rule skipped as resolution failure, shown as "filter:(missing)" in red), spending targets (stale reference → compute error, budget line shows zero or error).

#### 3.4.5 Chart Views

- **Display**: Shows current week boundary (Monday/Sunday), timeframe, history window (days), minor/major grid settings. Read-only display — only `spendingWeekAnchor` is editable.
- **Editing**: `h`/`l` or `Enter` toggles `spendingWeekAnchor` between Sunday and Monday.
- **Save**: Persists to `config.toml` via `saveSettingsCmd()`.
- **Effect on Dashboard**: Changes week boundary marker placement in Spending Tracker chart. Affects major gridline placement when `majorMode == spendingMajorWeek`.

#### 3.4.6 Database and Import

**Database info** (read-only display): Schema version, Transaction count, Category count, Rule count, Tag count, Tag Rule count, Import count, Account count, Rows per page, Command default.

**Schema versioning** (`db.go`): `schemaVersion = 7`. On startup, `ensureSchema()` compares the stored version from `schema_meta` against the constant. If behind, it applies sequential migration steps. `ensureRuntimeSchemaCompatibility()` runs after schema migrations and handles runtime-level changes (drops legacy `credit_offsets`, `manual_offsets`, `tag_rules` tables; creates `transaction_allocations`/`transaction_allocation_tags` tables if missing).

**Tables** (all SQLite, `db.go` lines 59–178 + runtime additions):

| Table | Key columns | Notes |
|---|---|---|
| `schema_meta` | `version` | Tracks schema version for migration |
| `categories` | `id`, `name UNIQUE`, `color`, `sort_order`, `is_default` | `is_default` protects "Uncategorised" from deletion |
| `tags` | `id`, `name UNIQUE`, `color` (default `#94e2d5`), `category_id` → `categories(id) ON DELETE SET NULL`, `sort_order` | Scoped tags via `category_id` |
| `transaction_tags` | `transaction_id` → `transactions(id) ON DELETE CASCADE`, `tag_id` → `tags(id) ON DELETE CASCADE` | Junction table. PK = (transaction_id, tag_id) |
| `rules_v2` | `id`, `name`, `saved_filter_id TEXT`, `set_category_id` → `categories(id) ON DELETE SET NULL`, `add_tag_ids TEXT` (JSON array), `sort_order`, `enabled`, `created_at` | `add_tag_ids` is a soft JSON reference (no FK) |
| `accounts` | `id`, `name UNIQUE`, `type CHECK(IN ('debit','credit'))`, `sort_order`, `is_active` | Every account has a type |
| `account_selection` | `account_id` → `accounts(id) ON DELETE CASCADE` | Persisted account scope selection |
| `transactions` | `id`, `date_raw`, `date_iso`, `amount`, `description`, `category_id` → `categories(id) ON DELETE SET NULL`, `notes`, `import_id` → `imports(id)`, `account_id` → `accounts(id)`, `created_at` | `import_id` links to import record |
| `imports` | `id`, `filename`, `row_count`, `imported_at` | Import history |
| `category_budgets` | `id`, `category_id UNIQUE` → `categories(id) ON DELETE CASCADE`, `amount`, `created_at` | One per category |
| `category_budget_overrides` | `id`, `budget_id` → `category_budgets(id) ON DELETE CASCADE`, `month_key`, `amount` | UNIQUE(budget_id, month_key) |
| `spending_targets` | `id`, `name`, `saved_filter_id TEXT`, `amount`, `period_type CHECK(IN ('monthly','quarterly','annual'))`, `created_at` | `saved_filter_id` is soft TEXT reference |
| `spending_target_overrides` | `id`, `target_id` → `spending_targets(id) ON DELETE CASCADE`, `period_key`, `amount` | UNIQUE(target_id, period_key) |
| `transaction_allocations` | `id`, `parent_txn_id` → `transactions(id) ON DELETE CASCADE`, `amount CHECK(amount != 0)`, `category_id` → `categories(id) ON DELETE SET NULL`, `note`, `created_at`, `updated_at` | Non-zero constraint enforced at DB level |
| `transaction_allocation_tags` | `allocation_id` → `transaction_allocations(id) ON DELETE CASCADE`, `tag_id` → `tags(id) ON DELETE CASCADE` | Junction for allocation tags |
| `filter_usage_state` | `filter_id TEXT PRIMARY KEY`, `last_used_unix`, `use_count` | Saved filter usage tracking, created at runtime |

**Indexes**: `idx_transactions_date` on `transactions(date_iso)`, `idx_transactions_category` on `transactions(category_id)`, `idx_filter_usage_last_used` on `filter_usage_state(last_used_unix DESC)`.

**Legacy tables** (dropped by `ensureRuntimeSchemaCompatibility`): `credit_offsets`, `manual_offsets`, `tag_rules`.

**CSV formats**: Not displayed in Settings. Formats live in `~/.config/jaskmoney/formats.toml` as a list of `[[format]]` blocks. The `csvFormat` struct defines these fields:

| Field | Type | Purpose |
|---|---|---|
| `name` | string | Display name |
| `account` | string | Target account name (resolved case-insensitively) |
| `import_prefix` | string | Filename prefix for `detectFormat` matching |
| `date_format` | string | Go time layout for parsing dates |
| `has_header` | bool | Skip first row |
| `delimiter` | string | CSV delimiter (default: comma) |
| `date_col` | int | Zero-indexed column for date |
| `amount_col` | int | Zero-indexed column for amount |
| `desc_col` | int | Starting column for description |
| `desc_join` | bool | If true, join desc_col through end of row |
| `amount_strip` | string | Characters to strip from amount string (e.g. `"$,"`) |

Each format also has optional `account_type`, `sort_order`, `is_active`, `description` fields matching the `accountConfig` struct. `loadFormats` creates defaults if the file is missing. `findFormat` is case-insensitive. `detectFormat` prefers filename prefix match, falls back to first format.

**No destructive clear/reset actions** in current implementation.

**Persistence**: All settings stored in `config.toml` and SQLite.

#### 3.4.7 Import History

- **List rendering**: Each import record shows filename, rows imported, timestamp. Empty state: "No imports yet."
- **Navigation**: Cursor moves through import history rows.
- **Actions**: No edit or delete actions for import history records (read-only).
- **Persistence**: `importRecord` structs loaded via `loadImports`, stored in SQLite.

---

## 4. Domain invariants

### 4.1 Accounts and account scope

- Accounts stored in `accounts` table with `name`, `type`, `sort_order`, `is_active`.
- `m.filterAccounts` (map[int64]bool, nil = all accounts) is the single source of account scope.
- Account scope persisted across restarts via `saveSelectedAccounts`.
- Account scope AND-composed with text filter in Manager. Also applied to Dashboard, Budget, and rules Apply/Dry Run.
- Import is NOT scoped by `m.filterAccounts` — each CSV format has a baked-in `accountID`.
- At least one account must exist (delete of last account blocked).
- Account scope remains after Esc in transactions mode (tested by `TestEscInTransactionsDoesNotClearAccountScope`).
- All accounts selected = `m.filterAccounts` reset to nil (UI shows "All Accounts").

### 4.2 Transactions and allocations

**Allocations split a parent transaction** into child rows tracked in `transaction_allocations`:
- Parent shows `fullAmount - SUM(allocations)` (remainder). Child shows allocated amount.
- Detail modal shows original `fullAmount` in brackets if different from displayed amount.
- Child rows prefixed with `↳   ` in transaction table.
- Both parent and child rows pass through `getFilteredRows()` independently. `evalFilter` runs against each row independently.
- Parent sorted by remainder amount. Child sorted by allocated amount.
- Child rows have independent category, tags, notes.

**Allocation constraints**:
- **Non-zero amount**: `normalizeAllocationAmount` rejects zero amounts.
- **Sign match**: Allocation amount sign must match parent transaction sign.
- **Capacity check**: `remainingAllocationCapacityTx` calculates remaining absolute capacity. Insert/update rejected if new amount exceeds remaining capacity.
- **Enforcement**: Both `insertTransactionAllocation` and `updateTransactionAllocationAmountAndNote` check capacity within the same SQL transaction.
- **No constraint on negative allocations** (credits against debits): sign-matching rule prevents this.
- **SQL constraints**: `ON DELETE CASCADE` from parent transaction. `category_id` has `ON DELETE SET NULL`.
- **Double counting prevention**: Transaction amount counted as either full (no allocations), sum of allocations (fully allocated), or remainder + allocations (partially allocated). Never both.

**Allocation deletion**: Deletes child row, restores parent's effective amount. Cascade from parent. Single allocation row can be deleted individually.

### 4.3 Categories and tags

**Categories vs tags**:

| Property | Categories | Tags |
|---|---|---|
| Cardinality per transaction | At most 1 | Many (many-to-many via junction table) |
| Assignment mode | Replace (last writer wins) | Accumulative (all matching rules add) |
| Filter field | `cat:` | `tag:` |
| Rules action | `set_category_id` (singular, overwrites) | `add_tag_ids` (JSON array, appended) |
| Allocation ownership | Each allocation has own `category_id` | Each allocation has own junction table |
| Deletion | `ON DELETE SET NULL` on transactions | `ON DELETE CASCADE` on transaction_tags |
| Protected default | "Uncategorised" cannot be deleted | `IGNORE` tag cannot be deleted |
| Colour metadata | `color` column | `color` column (default `#94e2d5`) |
| Inline creation in picker | Not supported (redirects to Settings) | Supported for global tags |
| Bulk operations | `updateTransactionsCategory` (update) | `addTagsToTransactions`/`removeTagFromTransactions` (add/remove) |
| Scoped | Always global | Can be scoped to a category (`category_id` in tags table) |

---

#### Colour palettes

Categories and tags use two distinct Catppuccin Mocha palettes with different colours and ordering:

**`CategoryAccentColors()`** — 15 colours: green, teal, peach, blue, mauve, pink, flamingo, sapphire, lavender, overlay1 (used for "Uncategorised"), yellow, red, maroon, rosewater, sky.

**`TagAccentColors()`** — 12 colours in a deliberately different order: rosewater, sky, lavender, flamingo, sapphire, yellow, maroon, mauve, pink, teal, blue, green.

`categoryColorIndex(hex)` and `tagColorIndex(hex)` map a stored colour back to its palette position on edit (linear search, returns 0 if not found). When rendering picker items, the colour swatch uses the entity's stored `color` hex value directly (not a palette index), with `#7f849c` (overlay1) or empty treated as the default muted foreground.

---

#### Picker filtering (fuzzy match)

All pickers (category, tag, saved-filter, account) share a single `pickerState` struct and filtering engine (`picker.go`). On every keystroke the picker calls `SetQuery(q)` → `rebuildFiltered()`:

**`fuzzyMatchScore(label, query)`** — sequential character match through lowercased strings. Each query character must appear in order in the label. Scoring:
| Condition | Bonus |
|---|---|
| Query character count (longer queries rank higher) | `+len(query)` base |
| First query char matches label start (prefix) | +10 |
| Consecutive matching characters | +3 per adjacent pair |
| Exact case-insensitive match | +20 |

**`rebuildFiltered()`** runs fuzzy match against every item's `Search` field (falls back to `Label` if `Search` is empty). Matching items are grouped by section, then sorted within each section by score descending, then by original insertion index for stable ordering. Sections are concatenated in insertion order. Cursor is clamped to the new filtered count.

The `Search` field on `pickerItem` allows custom search text beyond the label. Used by the saved-filter picker: `search = id + " " + name` so the filter can be found by either field.

---

#### Picker sections

**Category picker** (quick categorize, rule editor): No sections. Single flat list. All categories are items with their colour. Single-select (no checkboxes). `cursorOnly = true` (bold cursor, no selection background).

**Tag picker** (quick tags, rule editor): Three sections determined at build time by comparing each tag's `category_id` against the target context:

| Section | Condition | Order |
|---|---|---|
| Scoped | `tag.categoryID` matches a category of a target transaction (or matches `ruleEditorCatID` in rule editor) | First |
| Global | `tag.categoryID == nil` (no scope) | Second |
| Unscoped | `tag.categoryID` matches a category NOT in any target | Third |

Items are appended in Scoped → Global → Unscoped order during construction (`openQuickTagPicker` in `update_transactions.go`). `sectionOrder()` preserves this insertion order. Section headers are rendered as "Scoped:", "Global:", "Unscoped:" above their item groups.

---

#### Tri-state tag picker

The tag picker uses `SetTriState()` which initialises three maps:

- `checkState[id]`: `pickerStateNone` / `pickerStateSome` / `pickerStateAll` — current visual state
- `baseState[id]`: snapshot of initial state for dirty detection
- `dirty[id]`: tracks which items the user has toggled

**Toggle cycle**: Space on a tag cycles `pickerStateNone ↔ pickerStateAll`. `pickerStateSome` is only ever set during initialisation (when a tag is present on some but not all targets) — the user can never toggle into Some; it is exited on first toggle.

**Dirty tracking**: On toggle, the new state is compared against `baseState[id]`. If different, `dirty[id] = true`; if toggled back to base, `dirty[id]` is removed.

**`PendingTagPatch()`**: Iterates `dirty` and produces two sorted int slices:
- `addIDs`: tags where `checkState[id] == pickerStateAll`
- `removeIDs`: tags where `checkState[id] == pickerStateNone`

**`HasPendingChanges()`**: Returns `true` when `len(dirty) > 0` for tri-state pickers, or when `len(selected) != len(baseSelected)` for non-tri-state multi-select pickers.

**Enter behaviour** (four paths, from `update_transactions.go` and `picker.go:HandleMsg`):
1. **Rule editor tag picker, no pending changes**: toggles focused tag + closes (single toggle, no DB write).
2. **Quick tag picker, no pending changes**: toggles tag + applies to DB immediately + closes.
3. **Either context, pending changes**: applies all dirty changes (addIDs + removeIDs) to DB + closes.
4. **Multi-select submit** (explicit submission via `pickerActionSubmitted`): sets all selected tags (single transaction) or adds them (multi-transaction) to DB + closes.

---

#### Inline tag creation

Enabled by setting `createLabel: "Create"` on the picker. `shouldShowCreate()` returns true only when:
- Query is non-empty
- No item has a case-insensitive exact label match against the query

When true, a "Create 'query'" row appears at the bottom of the filtered list. Enter on this row returns `pickerActionCreate` with `CreatedQuery` set to the trimmed query. The handler in `update_transactions.go` calls `createGlobalTag(name)` then immediately adds the new tag to all targets. Category picker does not support inline creation — the "No category?" prompt redirects to Settings.

---

#### Picker rendering and interaction model

All pickers render as a modal overlay with: title, search/filter line at top ("Filter: (type to filter)"), section headers, item rows with cursor and selection markers, and a footer with keybinding hints.

**Item row rendering**:
- Single-select mode (`cursorOnly = true`): cursor shown as `> ` prefix, cursor row bolded. No selection background.
- Multi-select mode (`cursorOnly = false`): cursor row gets selection background, cursor row bolded if it's the cursor. No `> ` prefix — column space used for `[x]` / `[ ]` / `[-]` checkboxes.
- Tri-state checkboxes: `[x]` = All, `[-]` = Some, `[ ]` = None.
- Colour swatch foreground: uses `it.Color` hex value directly. Falls back to `colorOverlay1` if colour is empty or `#7f849c`.

**Key dispatch**: `HandleMsg()` maps action-based keys (up/down/toggle/select/close) via the caller-provided `matches` function. `HandleKey()` is a simpler string-based path used in tests and for direct keyboard input. Both paths route printable ASCII keys to `SetQuery()` for incremental filtering.

### 4.4 Filters and saved filters

**Three-state filter model.** The filter input system maintains three distinct pieces of state updated at different rates:

| State | Type | Updated | Source |
|---|---|---|---|
| `filterInput` | `string` | Every keystroke | Raw text typed in the `/` input bar |
| `filterExpr` | `*filterNode` | Every keystroke | Live AST via `reparseFilterInput()` (permissive parse) |
| `filterLastApplied` | `string` | Only on Enter | Canonical string via `parseFilterStrict` |

`filterExpr` drives the transaction table in real time — every keystroke re-parses and re-filters. `filterLastApplied` is the "committed" form used by `filter:save` (which blocks if `filterLastApplied` is empty, meaning the user hasn't pressed Enter). When Enter fails strict parsing, `filterLastApplied` is set to empty but `filterExpr` continues to work — the visual filter and the savable filter can diverge.

---

#### Parser architecture (`filter.go`)

**Lexer** (`lexFilter`): Custom byte-level tokenizer producing 10 token kinds: `filterTokWord`, `filterTokQuoted`, `filterTokColon`, `filterTokLParen`, `filterTokRParen`, `filterTokAnd`, `filterTokOr`, `filterTokNot`, `filterTokEOF`, `filterTokInvalid`. Quoted strings support two escape sequences (`\"` and `\\`). Bare keywords `AND`, `OR`, `NOT` are case-sensitive and tokenized as operators, not words.

**Recursive descent parser** (`filterParser`): Four-layer precedence cascade:

```
parseExpr  →  parseOrExpr  →  parseAndExpr  →  parseUnary  →  parseTerm
```

- **parseOrExpr**: Collects a flat list of AND-expressions joined by `OR`. Multiple ORs produce a single `filterNodeOr` with N children (not a binary tree).
- **parseAndExpr**: Handles explicit `AND` and implicit AND between adjacent terms. `filterCanStartTerm()` determines whether the next token begins a term — this is what makes `cat:Food amt:>50` work as `cat:Food AND amt:>50` without the user typing `AND`.
- **parseUnary**: Handles `NOT` prefix with one child.
- **parseTerm**: Dispatches to `(group)`, `"quoted string"`, field predicate (`field:value`), or bare word.

**Field predicate detection**: `isFieldPredicateAt()` does a two-token lookahead. If the current token is a `filterTokWord` and the next is `filterTokColon`, and the word is a recognised field (`desc`, `cat`, `tag`, `acc`, `amt`, `type`, `note`, `date`), it routes to `parseFieldPredicate`. Otherwise the word becomes a text node.

**The `grouped` flag.** Every `filterNode` has a `grouped` bool, set to `true` when the node was created from parenthesized source `(...)`. This flag drives three behaviours:

1. **Flattening** (`flattenFilterChildren`): Same-kind boolean nodes (AND-within-AND, OR-within-OR) are collapsed into a flat children list — *unless* the inner node has `grouped=true`, which preserves the original boundary.
2. **Strict-mode validation** (`validateStrictGrouping`): Walks the tree for mixed AND/OR at the same level. If an AND contains an ungrouped OR child (or vice versa), the expression is rejected with a suggestion to add parentheses.
3. **Canonical rendering** (`needsFilterParens`): Parentheses are emitted in `renderFilterNode` when a child's precedence is lower than the parent's, and additionally in strict-groups mode when types mismatch without grouping.

**Flattening optimisation**: `flattenFilterChildren` prevents AST depth growth from repeated same-operator joins. `a AND b AND c` becomes `AND(a, b, c)` not `AND(a, AND(b, c))`. This matters for evaluation and rendering.

---

#### Field predicate semantics

Each field has a specific value parser and operator set:

**`amt:`**: Accepts `=value`, `>value`, `<value`, `>=value`, `<=value`, `lo..hi`, or bare `value` (treated as `=`). Uses `canonicalFloat` (Go's `FormatFloat` with `-1` precision) for canonical representation. Multi-word not allowed — `amt:> 50` fails because `>` prefix binds to the number without space.

**`date:`**: Accepts three formats via `canonicalDateToken`:
- ISO day: `2024-01-15` (10 chars, dashes at 4 and 7)
- ISO month: `2024-01` (7 chars, dash at 4)
- Short year-month: `24-01` (5 chars, dash at 2, year offset +2000)

`=` on a month token matches the entire month range via `dateTokenBounds` (first to last day). `lo..hi` supports any mix of the three formats; range is validated by comparing the computed start of `lo` against the end of `hi`. Multi-word not allowed.

**`type:`**: Maps to amount sign: `type:debit` matches `amount < 0`, `type:credit` matches `amount > 0`. Only `=` semantics. Multi-word not allowed.

**`cat:`, `tag:`, `acc:`**: Case-insensitive equality (`strings.EqualFold`). Multi-word values allowed (whitespace-joined). No comparison operators — only `=` semantics (the `=` is implicit).

**`desc:`, `note:`**: Substring match (`strings.Contains`, case-insensitive). Multi-word values allowed. No comparison operators — only `contains`.

**Bare words**: Become `filterNodeText` nodes with `op="contains"`, matching against `description`. When no field predicates exist in the expression, `markTextNodesAsMetadata` promotes bare words to `op="contains_meta"`, which also searches `categoryName` and tag names. This is the mechanism behind "plain text search across descriptions, categories, and tags."

**`fallbackPlainTextFilter`**: When `lexFilter` or `parseFilter` returns an error in permissive mode, the filter system doesn't discard the input — it wraps the raw string in a single `contains_meta` text node. This means `amt:abc` (invalid amount) still filters as a plain-text search for `"amt:abc"` rather than returning no results.

---

#### Real-time parsing lifecycle

**Keystroke flow** (every printable character or backspace):

1. Character is inserted/deleted in `filterInput` (ASCII-safe via `insertPrintableASCIIAtCursor` / `deleteASCIIByteBeforeCursor`).
2. `filterLastApplied` is cleared to `""`.
3. `reparseFilterInput()` runs:
   - Empty input → `filterExpr = nil`, `filterInputErr = ""`.
   - Calls `parseFilter(filterInput)` (permissive).
   - Parse error → `filterExpr = fallbackPlainTextFilter(filterInput)`, `filterInputErr = err.Error()`.
   - Success, no field predicates → `filterExpr = markTextNodesAsMetadata(node)`.
   - Success, has field predicates → `filterExpr = node`, `filterInputErr = ""`.
4. `cursor = 0`, `topIndex = 0` (reset table scroll position).
5. `evalFilter(filterExpr, ...)` runs against every row. `getFilteredRows()` rebuilds the displayed set.

**Enter flow** (`actionConfirm` in `scopeFilterInput`):

1. Calls `parseFilterStrict(filterInput)` — strict mode.
2. If strict succeeds → `filterLastApplied = filterExprString(node)` (canonical form).
3. If strict fails → `filterLastApplied = ""` (live filter still works, but save is blocked).
4. `filterInputMode = false` (returns focus to table navigation).
5. `drillReturn = nil` (clears drill-down context).
6. Filter bar transitions from active editing to "applied pill" state: `transactionFilterBar()` shows green dot + "ok" label + "(esc clear)" hint.

**Esc flow** (`actionClearSearch` in `scopeFilterInput`, `updateFilterInput`):

1. If `drillReturn != nil`: calls `restoreDrillReturnToDashboard()` — returns to Dashboard tab, restores focused pane, restores pre-drill `filterInput`/`filterExpr`. This is the only path that switches tabs from Esc.
2. Otherwise: `filterInputMode = false`, `filterInput = ""`, `filterInputCursor = 0`, `filterExpr = nil`, `filterInputErr = ""`, `filterLastApplied = ""`, `cursor = 0`, `topIndex = 0`.

Note: `scopeTransactions` also binds `actionClearSearch` (key `esc`) via the command system (`filter:clear` command), but the overlay `scopeFilterInput` handler at line 163 of `dispatch.go` takes precedence when `filterInputMode` is true. The `filter:clear` command handles the non-input case (filter active but not editing).

---

#### AND-composition graph

Filters are never evaluated in isolation. Multiple filter sources are AND-composed via `andFilterNodes()`:

```
buildTransactionFilter():
    andFilterNodes(currentInputFilterNode(), buildAccountScopeFilter())

buildDashboardScopeFilter():
    andFilterNodes(buildAccountScopeFilter(), timeframeFilter())

buildDashboardModeFilter(mode):
    andFilterNodes(buildDashboardScopeFilter(), mode-specific-predicate)
```

**`currentInputFilterNode()`** (source of truth for the text-input-derived filter):
- Empty input → `nil`.
- `filterExpr` set → returns `filterExpr` (the live-parsed node).
- `filterExpr` nil → calls `parseFilter(filterInput)`, falls back to `fallbackPlainTextFilter`, conditionally promotes to `contains_meta` via `markTextNodesAsMetadata`.

**`andFilterNodes()`** / **`orFilterNodes()`**: Composition helpers that flatten same-kind children, skip nil inputs, and return `nil` for empty compositions. A single non-nil input is returned unwrapped. These are used throughout — drill-down composition, dashboard scope, account scope, custom mode filters.

**Account scope filter** (`buildAccountScopeFilter`): Produces a `filterNodeField{field: "acc", op: "=", value: accountName}` for each selected account, joined with OR. When `m.filterAccounts == nil` (all accounts selected), the filter node is nil and drops out of the AND-composition.

**Evaluation path** (`getFilteredRows` → `evalFilter` per row):
1. Load unfiltered rows via `m.managerRowsUnfiltered()`.
2. Build composed filter via `andFilterNodes(currentInputFilterNode(), buildAccountScopeFilter())`.
3. Load effective tags per transaction via `m.effectiveTxnTags()` (merges transaction_tags and transaction_allocation_tags).
4. For each row: `evalFilter(filter, row, tags[row.id])`.
5. `evalFilter` walks the AST — AND (all children true), OR (any child true), NOT (negates child), text (substring), field (dispatches to per-field eval).

---

#### Interactive mode lifecycle

**Activation** (`/` key or `filter:open` command):
- Two paths converge on the same state:
  - Keybinding `/` in `scopeTransactions` → `actionSearch` → sets `filterInputMode = true`, `filterInputCursor = len(filterInput)`.
  - `filter:open` command in `scopeTransactions`/`scopeManager` → clears range selection, switches from accounts mode to transactions mode, then same state.
- `filterInputMode = true` is the guard for the `filterInput` overlay entry in `overlayPrecedence()` (lowest priority overlay, after jump/command/detail/import/filePicker/catPicker/tagPicker/quickOffset/filterApplyPicker/managerActionPicker/filterEdit/managerModal/dryRun/ruleEditor).

**Overlay position**: `filterInput` is the last (lowest priority) entry in `overlayPrecedence()`. Its `forFooter = true` and `forCommandScope = true`, so when active it provides `scopeFilterInput` keybindings in footer and command palette: Enter (confirm), Esc (clear), Ctrl+S (save), Ctrl+L (load), left/right (cursor movement).

**View state rendering**:
- `transactionFilterBar()` renders the filter bar above the transaction table.
- Active editing (`filterInputMode=true`): shows `/` prompt + input text with cursor + colored dot (green=ok, red=parse error).
- Applied mode (`filterInputMode=false`, `filterInput != ""`): shows `/` prompt + input text + dot + "(esc clear)" hint.
- `activeFilterPill()` renders the canonical expression in brackets `[cat:Food]` next to the filter bar. Blue for valid, red for errors. Prepends `[Dashboard >]` prefix when `drillReturn` is active.
- When `filterInput` is empty and not in input mode, both renderings produce empty strings — no filter bar shown.

---

#### Commands: save and apply

**`filter:save`** (Ctrl+S in `scopeFilterInput` or `scopeTransactions`):
- Enabled only when: `filterInput` non-empty, `parseFilterStrict` passes, and `filterLastApplied` non-empty (user pressed Enter).
- Calls `openFilterEditor(nil, filterInput)`: opens the saved filter editor modal (`filterEditOpen = true`) pre-filled with the current expression. Generates an auto-ID like `filter-1`.
- The filter editor validates with `parseFilterStrict` on save and blocks invalid expressions.

**`filter:apply`** (Ctrl+L in `scopeFilterInput`, `scopeTransactions`, or `scopeManager`):
- Opens `filterApplyPicker` — a filtered list of all saved filters, searchable by ID or name.
- Selection calls `applySavedFilterByID(id)` → `applySavedFilter(saved, true)`:
  1. Clears `drillReturn` if active.
  2. Switches from accounts mode to transactions mode if needed.
  3. Sets `filterInput = saved.Expr`.
  4. Calls `reparseFilterInput()` to rebuild `filterExpr` from the saved expression.
  5. Sets `filterInputMode = false` (directly into applied state, no editing).
  6. Sets `filterLastApplied = saved.Expr` (canonical form, no re-strict-parse — saved filters are already strict-validated at save time).
  7. Resets `cursor = 0`, `topIndex = 0`.
  8. Calls `touchSavedFilterUsage` to bump recency.
- Per-saved-filter commands are auto-generated as `filter:apply:<id>` (e.g., `filter:apply:groceries`). These are discoverable in the command palette for quick invocation without the picker.

**`filter:open`**: Opens the filter input without requiring `/` key — e.g., from command palette. Clears range selection. Clears `drillReturn` if the call comes from `scopeTransactions`? No — `filter:open` does not clear drill return; the `applySavedFilter` path does.

**`filter:clear`**: Clears filter input state. Also clears range selection if no filter is active. Also clears row selections if neither filter nor range is active. Single command degrades through all three states.

---

#### filterUsage tracking

Every `applySavedFilter` call with `trackUsage=true` calls `touchSavedFilterUsage(id, true)` which updates an in-memory map of `filterID → lastUsedTimestamp`. This map is used by `orderedSavedFilters()` to sort by recency. Not persisted across restarts.

---

#### Parser mode summary

| Context | Parser | On failure | Validates grouping |
|---|---|---|---|
| Interactive `/` input (live) | `parseFilter` (permissive) | `fallbackPlainTextFilter` | No |
| Enter key in filter input | `parseFilterStrict` (strict) | `filterLastApplied = ""` (blocked) | Yes |
| Saved filter save | `parseFilterStrict` | Blocks save, shows error | Yes |
| Saved filter load (startup) | `parseFilterStrict` | Skipped with warning | Yes |
| Rule/target resolution | `parseFilterStrict` | Resolution failure (rule skipped) | Yes |
| Saved filter apply (Ctrl+L) | Expression already strict-validated at save | N/A | N/A |

---

#### Saved filter lifecycle

- Stored in `config.toml` as `[[saved_filters]]` blocks with `id`, `name`, `expr`.
- Startup: `normalizeFilterConfigEntries` loads and validates each entry with `parseFilterStrict`. Invalid entries are skipped with a warning but preserved in the config file.
- Save: validates ID uniqueness, validates expression with `parseFilterStrict`, persists entire list to `config.toml` via `saveSavedFilters`.
- Delete: removes from in-memory list and persists. Stale `saved_filter_id` references remain in rules and targets (soft reference, no FK constraint).
- Rename (ID change): equivalent to delete+create. All old references become stale — no cascade update.
- Missing dependency in rule: rule skipped during Apply/Dry Run, shown as "filter:(missing)" in red in the rules list.
- Missing dependency in target: `computeTargetLines` shows zero or error for that target line.
- Duplicate ID: blocked on save.

### 4.5 Rules

**Data types** (all in `db.go`):

| Type | Fields | Purpose |
|---|---|---|
| `ruleV2` | `id`, `name`, `savedFilterID` (string), `setCategoryID` (*int, nullable), `addTagIDs` ([]int), `sortOrder`, `enabled` | Persisted rule from `rules_v2` table |
| `resolvedRuleV2` | `rule` (ruleV2), `filterExpr` (string), `filterName` (string), `parsed` (*filterNode) | Rule with saved filter resolved to a parse tree |
| `ruleResolutionFailure` | `rule` (ruleV2), `reason` (string) | Rules that could not be resolved (missing/invalid saved filter) |
| `dryRunRuleResult` | `rule`, `filterExpr`, `filterName`, `matchCount`, `catChanges`, `tagChanges`, `samples` ([]dryRunSample) | Per-rule dry run result |
| `dryRunSample` | `txn`, `currentCat`, `newCat`, `addedTags` ([]string) | Sample transaction affected by a rule (up to 3 per rule) |
| `dryRunSummary` | `totalModified`, `totalCatChange`, `totalTagChange`, `failedRules` | Aggregate dry run counts |

**Resolution** (`resolveRulesV2`):
1. Copy and stable-sort rules by `sortOrder ASC`, then `id ASC` for tie-breaking.
2. Build `filterMap` from `savedFilters` keyed by ID.
3. For each enabled rule: look up its `savedFilterID` in the map. If found, parse the expression via `parseFilter`. If the filter is missing, the expression is invalid, or the ID doesn't exist — record a `ruleResolutionFailure`.
4. Returns `([]resolvedRuleV2, []ruleResolutionFailure)`. Resolutions happen before any row iteration — failures do not block execution, they're reported in counts.

**Application** (`applyResolvedRulesV2ToRows`):
1. Load categories and tags for name/ID lookups.
2. Begin DB transaction. Full rollback on any error.
3. For each row, maintain a **work copy** of category pointer and tag set:
   - Start: copy of current DB state.
   - Iterate resolved rules in order.
   - If rule's filter (`evalFilter(rule.parsed, workTxn, tagStateToSlice(...))`) matches:
     - **Category**: set `workCat = rule.setCategoryID` (last matching rule wins — later rules overwrite earlier category assignments).
     - **Tags**: merge rule's `addTagIDs` into work tag set (accumulative — tags accumulate across matching rules, never removed).
4. After all rules processed for a row, diff work state against original DB state:
   - Category changed → `UPDATE transactions SET category_id WHERE id = ?`.
   - Tags added → `INSERT INTO transaction_tags ... ON CONFLICT DO NOTHING`.
   - Tags removed only if the original had tags the work set lost — which never happens since tags are only added. (Work set starts from current state and only adds.)
5. `catChanges` = number of rows with category change. `tagChanges` = number of tag-insertion rows affected. `updatedTxns` = rows with either change.
6. Commit. Full rollback on any error.

**Entry points**:
- `applyRulesV2ToScope`: loads rows for the account scope filter, resolves rules, applies. Used by `rules:apply` command.
- `applyRulesV2ToTxnIDs`: loads rows by specific transaction IDs, resolves rules, applies. Used by import commit path.
- Both delegate to `applyResolvedRulesV2ToRows` with the resolved rules.

**Dry Run** (`dryRunRulesV2`):
1. Same resolution + evaluation core as Apply: `resolveRulesV2` + rule iteration over rows with work-copy semantics.
2. All operations on in-memory copies — no DB writes.
3. Per-rule results track `matchCount` (rows matched by that rule), `catChanges` and `tagChanges` attributed to that rule, and up to 3 `samples` (dryRunSample showing the transaction, old category name, new category name, and added tag names).
4. Summary: `totalModified` (rows with any change), `totalCatChange` (rows with category change), `totalTagChange` (tag additions), `failedRules` (from resolution failures).
5. **Parity invariant**: The evaluation pipeline is identical between Apply and Dry Run — same `resolveRulesV2`, same `evalFilter`, same work-copy category/tag mutation semantics.

**Dry Run result modal** (`renderDryRunResultsModal`): Shows scope label, summary line (modified/category/tag/failed counts), then per-rule scrollable results (up to 3 visible at a time). Each rule section shows: rule name + enabled state, filter expression, match count, category+tag change counts, and sample transactions (dateISO, amount, truncated description). Footer: scroll keys + `Esc` close. Modal width 96.

**Rule reordering** (list view `K`/`J`): `K` moves rule up (decreases sortOrder by swapping with the rule above), `J` moves down. Updates both rules' `sortOrder` in DB via `reorderRuleV2`.

**Rule editor modal** (multi-step): Opens with `a` (add) or `Enter` (edit). Steps navigated via `Tab`/`Shift+Tab`:
1. **Name**: text input for rule name.
2. **Saved Filter**: opens saved filter picker. The picker shows all saved filters by name. Selected filter's expression becomes the rule trigger.
3. **Set Category**: optional category picker (single-select). If left blank, rule does not change category.
4. **Add Tags**: optional tag picker (multi-select). Selected tag IDs stored as JSON array in `add_tag_ids`.
5. **Enabled**: toggle via action key. State rendered with `✓`/`✗` indicator.

**Scope label**: Shows "All Accounts" or "N selected" based on `m.filterAccounts`. Used in both Apply and Dry Run to indicate which transactions are affected.

### 4.6 Import

**Two import paths**:

1. **Direct import** (`ingestCmd`, non-interactive, used from command palette or file picker auto-import): Parses CSV, imports rows, records import, applies rules, all in one shot. Uses `importCSVForAccountWithTxnIDs` which handles duplicate detection internally.

2. **Preview-based import** (interactive, used from file picker → preview modal): Two-phase flow:
   - **Phase 1 — Scan**: `scanDupesCmd` → `buildImportPreviewSnapshot()`. Parses CSV, checks duplicates against DB, builds a frozen `importPreviewSnapshot`, materialises and locks rules. Returns `importPreviewMsg{snapshot}`.
   - **Phase 2 — Commit**: `ingestSnapshotCmd(snapshot, skipDupes, applyRules)`. Reuses snapshot data — no re-parsing. Optionally applies locked rules. Returns `ingestDoneMsg`.

**Import preview snapshot** (`importPreviewSnapshot`, created by `buildImportPreviewSnapshot`):

| Field | Purpose |
|---|---|
| `fileName` | Basename of imported file |
| `createdAt` | Snapshot timestamp |
| `totalRows` | Rows in CSV (including header if present) |
| `rows` | `[]importPreviewRow` — parsed rows with pre- and post-rule projections |
| `parseErrors` | `[]importPreviewParseError` — rows that failed parsing |
| `errorCount` | Count of parse errors (blocks commit if > 0) |
| `newCount` | Non-duplicate rows |
| `dupeCount` | Duplicate rows |
| `lockedRules` | `importPreviewLockedRules` — rules materialised at preview time |
| `accountID` | Target account captured at preview-open |

**Snapshot construction flow** (`buildImportPreviewSnapshot`):
1. Load existing duplicate set from DB via `loadDuplicateSet()` (all `"dateISO|amount_2dp|lowercase_desc|accountID"` keys for the target account).
2. Parse CSV via `parseImportPreviewRows()` — reads file, applies `csvFormat` column mapping, validates dates, parses amounts (strips `amount_strip` chars), checks duplicates against the loaded set and intra-file duplicates.
3. Count new/duplicate rows.
4. Load and resolve rules via `resolveRulesV2(rules, savedFilters)` — maps each rule's `saved_filter_id` to its expression. Resolution failures recorded but don't block preview.
5. Lock rules into snapshot: stores rule IDs, full rule list, lock reason, and **materialised `resolved` rules** — guaranteeing the exact same rule evaluation on commit.
6. Apply rules to preview rows via `projectImportPreviewRows()` — sets `previewCat`/`previewTags`/`previewCatColor`/`previewTagObjs` on each row for the "post-rules" preview column.

**Rules locking**: When preview is open, the resolved rule set is materialised into `snapshot.lockedRules.resolved`. Any changes to rules or saved filters between preview and commit do not affect the snapshot. This guarantees preview/apply parity — the commit applies the exact same rule evaluation the user saw in preview.

**Import commit** (`ingestSnapshotCmd`):
1. Rejects if snapshot has any parse errors (`errorCount > 0`).
2. Inserts non-duplicate rows in a single DB transaction via `importSnapshotRows()`.
3. Records import via `insertImportRecord(db, fileName, count)` — creates an `imports` row.
4. If `applyRules` is true, applies `snapshot.lockedRules.resolved` to the newly created transaction IDs via `applyResolvedRulesV2ToTxnIDs()`.
5. Returns `ingestDoneMsg` with counts and rule application summary (updatedTxns, catChanges, tagChanges).

**Import preview rendering** (`renderImportPreviewCompact`, `renderImportPreviewTable`): Shows two-column view — "Before Rules" (date, description, amount) and "After Rules" (category, tags). Rows colour-coded: green for new, yellow for duplicates. Parse errors listed separately with line numbers. Compact mode used within preview modal (limited rows); full table mode available via `import:show-all` command.

**Commands**: `import:preview` (scan file), `import:commit` (import snapshot + apply rules), `import:commit-norules` (import snapshot, skip rules), `import:skip-dupes` (skip duplicates), `import:force` (import duplicates), `import:show-all` (toggle compact/full preview), file picker navigation.

**Duplicate detection** (`duplicateKeyForAccount`):
- Key: `"<dateISO>|<amount_2dp>|<lowercase_description>|<accountID>"`.
- Amount formatted to 2 decimal places.
- Description converted to lowercase.
- Scoped to single account (same date+amount+desc in different account = not a duplicate).
- Intra-file duplicates detected (same row in CSV twice — second occurrence).
- Allocation rows excluded from duplicate detection.

**Duplicate set** (`loadDuplicateSet`): Pre-loaded into memory at preview time as `map[string]bool`. Used for both inter-file (existing DB rows) and intra-file (same CSV) duplicate checks. Intra-file duplicates are detected by accumulating seen keys during parse.

**Direct import path** (`importCSVForAccountWithTxnIDs`):
1. Opens and parses CSV using format's column mapping.
2. Checks each row against existing DB duplicates.
3. Inserts non-duplicate rows in a single DB transaction.
4. Returns inserted count, dupe count, and new transaction IDs.
5. `ingestCmd` then records the import (`insertImportRecord`) and applies rules to the new transaction IDs.

**Commit behaviour**: All writes in single DB transaction. Bad row → full rollback (`TestImportCSVBadRowRollsBackNoPartialWrites`).

### 4.7 Budgets and targets

**Category budgets**:
- Default amounts in `category_budgets` table.
- Month-specific overrides in `category_budget_overrides`.
- Budget effective = override if exists, else default.
- Spent = sum of negative amounts (expenses) from effective rows in category, within date range and account scope.
- Remaining = budgeted - spent.
- Over-budget if remaining < 0.

**Spending targets**:
- Defined by `name`, `savedFilterID`, `amount`, `periodType` (monthly/quarterly/annual).
- Period overrides in `spending_target_overrides`.
- Effective rows include both original transactions and child allocations.
- Spent = sum of debits matching filter expression, within period and account scope.
- Remaining = target - spent.
- Missing/deleted saved filter → compute error (budget line shows zero or error).

**Legacy offset removal**: `credit_offsets` and `manual_offsets` tables dropped by `ensureRuntimeSchemaCompatibility`. Transaction allocations are the canonical adjustment mechanism.

### 4.8 Picker infrastructure

The generic `pickerState` (`picker.go`) is used by 7+ features: category picker, tag picker, saved filter picker, manager action picker, file picker, rule filter picker, rule category picker, rule tag picker.

**Core types**:

| Type | Fields | Notes |
|---|---|---|
| `pickerItem` | `ID` (int), `Label` (string), `Color` (string), `Section` (string), `Meta` (string), `Search` (string) | Each item in the picker list. Section used for grouping. Search is optional alternate text for matching. |
| `pickerState` | `items`, `filtered`, `query`, `cursor`, `selected` (map[int]bool), `baseSelected`, `checkState`, `baseState`, `dirty`, `multiSelect`, `cursorOnly`, `triState`, `title`, `createLabel` | Full picker state. See below for semantics. |
| `pickerCheckState` | `pickerStateNone` (0), `pickerStateSome` (1), `pickerStateAll` (2) | Tri-state: no targets have tag, some targets have tag, all targets have tag. |
| `pickerAction` | `None`, `Moved`, `Toggled`, `Selected`, `Submitted`, `Create`, `Cancelled` | Enum returned in `pickerResult` to describe what happened. |
| `pickerResult` | `Action` (pickerAction), `ItemID`, `ItemLabel`, `CreatedQuery`, `SelectedIDs` ([]int) | Result of a picker interaction. |
| `scoredPickerItem` | `item` (pickerItem), `score` (int), `index` (int) | Item with fuzzy match score for filtering. |

**Picker rendering** (`renderPicker`):

1. **Header**: Title in bold accent. If `query` is non-empty, shows filter query with clear hint.
2. **Filtered items**: Rendered as picker rows. Items scored via `fuzzyMatchScore` against `query` and sorted descending by score. Empty query shows all items unsorted.
3. **Row format**: `checkbox + colour swatch (if any) + label`. Checkbox is `[✓]` (selected), `[~]` (some), `[ ]` (unselected) for multi-select/tri-state; `>` (cursor) for single-select. Cursor row shows `>` prefix.
4. **Sections**: Rendered as `── section_name ──` separators. Items grouped by `pickerItem.Section`. Only sections with matching items shown.
5. **Create row**: If `createLabel` is non-empty and the query doesn't match any existing item, shows `+ Create "query"` at bottom.
6. **Footer**: Scope-appropriate keybinding hints via `actionKeyLabel`.

**Fuzzy matching** (`fuzzyMatchScore`): Query lowercased. Each item's `Label` and `Search` fields checked:
- Prefix match (query is a prefix of any word): +10 per word.
- Consecutive character match (query chars appear consecutively within a word): +3 per character.
- Exact match (query equals the full word): +20 per word.
Score = sum of bonuses. Minimum 0. Items with score 0 excluded when query non-empty.

**Initialisation** (`newPicker(title, items, multiSelect, createLabel)`):
- `multiSelect=true`: renders checkboxes, enables bulk selection.
- `triState=true` (tag picker only): initialises `checkState`/`baseState` from provided per-item values.
- `cursorOnly=false` (default): clicking row selects; `cursorOnly=true`: cursor indicates selection (tag picker where cursor alone marks the focused tag).
- `createLabel` non-empty: enables inline creation (e.g. "new tag").

**Key handling** (varies by calling context):
- `Enter` on filter apply picker: submits selected filters. `Esc` cancels.
- `Enter` on tag picker with pending changes (`HasPendingChanges`): applies dirty additions+removals to DB via `PendingTagPatch()` returning `(addIDs, removeIDs)`.
- `Enter` on tag picker without pending changes: toggles focused tag and closes.
- `Enter` on single-select picker (category, saved filter): selects focused item and closes.
- `Space`: toggles focused item. For tri-state pickers, `SetTriState` cycles All→None→All, adds to `dirty` map.
- Printable keys: appended to `query`, re-filters via `fuzzyMatchScore`.
- `Backspace`: removes last query character.

**Tag-specific additions** (`SetTriState`): Per target row, tracks whether tag is present. `checkState` per item: `All` (present on all targets), `Some` (present on some targets), `None` (present on none). `Space` cycles All→None→All. Dirty changes accumulate in `addIDs`/`removeIDs` maps.

**Picker usage matrix**:

| Picker | Scope | multiSelect | triState | createLabel | Used by |
|---|---|---|---|---|---|
| Quick category picker | `scopeCategoryPicker` | No | No | — | `openQuickCategoryPicker` |
| Quick tag picker | `scopeTagPicker` | Yes | Yes | "new tag" | `openQuickTagPicker` |
| Saved filter picker | `scopeFilterApplyPicker` | No | No | — | `openSavedFilterPicker` |
| Manager action picker | `scopeManagerActionPicker` | No | No | — | Manager account actions |
| Rule filter picker | `scopeRulePicker` | No | No | — | Rule editor step 2 |
| Rule category picker | `scopeRulePicker` | No | No | — | Rule editor step 3 |
| Rule tag picker | `scopeRulePicker` | Yes | No | — | Rule editor step 4 |

---

## 5. Cross-screen state and data flow

### 5.1 Cross-screen scope matrix

| Scope | Dashboard | Budget | Manager | Rules Apply | Rules Dry Run | Saved-filter count | Import |
|---|---|---|---|---|---|---|---|
| Account scope | Applied (AND-composed) | Applied (via `accountFilter`) | Applied (AND-composed) | Applied | Applied | Applied | Per-format (baked-in) |
| Dashboard timeframe | Applied | Not applied (independent) | Not applied | Not applied | Not applied | Not applied | N/A |
| Budget period | Syncs month anchor | Applied | N/A | N/A | N/A | N/A | N/A |
| Manager filter text | Ignored (isolated) | Ignored | Applied | N/A | N/A | N/A | N/A |
| Manager saved filter | Ignored | Ignored | Applied (via saved-filter selection) | N/A | N/A | N/A | N/A |
| Drill filter | Replaces Manager filter | N/A | Replaced by drill predicate | N/A | N/A | N/A | N/A |
| Rules scope | N/A | N/A | N/A | Applied (account scope) | Applied (account scope) | N/A | Applied (to imported rows only) |
| Import snapshot account | N/A | N/A | N/A | Applied (to imported rows) | N/A | N/A | Applied (per-format) |

**Key invariant**: Dashboard default panes use timeframe + account scope only — no transaction filter inheritance. Drill-down replaces Manager filter temporarily. Budget month syncs with Dashboard month anchor.

### 5.2 Refresh pipeline

`refreshCmd(m.db)` (`db.go:3493`) reloads after every major mutation. It loads: `rows`, `categories`, `rules`, `tags`, `txnTags`, `imports`, `accounts`, `selectedAccounts`, `info`, `filterUsage`.

`handleRefreshDone` receives the `refreshDoneMsg` and:
1. Checks for errors → sets error status if any.
2. Updates all model fields with fresh data.
3. Loads budget data (categoryBudgets, budgetOverrides, spendingTargets, targetOverrides, allocations) if `m.db` is available.
4. Sets `m.ready = true`.
5. Prunes selections (`pruneSelections`), clamps cursor (`ensureCursorInWindow`), validates range (`ensureRangeSelectionValid`).

**Refresh triggers per mutation**:

| Mutation | Refresh trigger | What reloads |
|---|---|---|
| Transaction edit/save | `txnSavedMsg` → `refreshCmd` | Everything |
| Category assignment | `applyCategoryToRowTargets` → `refreshCmd` | Everything |
| Tag patch | `addTagsToRowTargets`/`removeTagFromRowTargets` → `refreshCmd` | Everything |
| Allocation create/edit/delete | `insertTransactionAllocation`/`updateTransactionAllocation*` → `refreshCmd` | Everything |
| Account-scope change | `persistManagerAccountScopeCmd` returns `accountScopeSavedMsg`; handler sets status or error only — no `refreshCmd`. In-memory `m.filterAccounts` already reflects the toggle immediately. | No DB reload (scope already applied in-memory) |
| Account delete | `deleteAccount` → error or `refreshCmd` | Everything |
| Category/tag edit | `categorySavedMsg`/`tagSavedMsg` → `refreshCmd` | Everything |
| Saved-filter edit | `saveFilterEditor` → `refreshCmd` | Everything |
| Rule Apply | `applyResolvedRulesV2ToRows` → `refreshCmd` | Everything |
| Import commit | `ingestSnapshotCmd` → `refreshCmd` | Everything |
| Budget edit | `upsertCategoryBudget`/`upsertBudgetOverride` → `refreshCmd` | Everything |
| Target create/delete | `insertSpendingTarget`/`deleteSpendingTarget` → `refreshCmd` | Everything |
| Target override edit | `upsertTargetOverride` → `refreshCmd` | Everything |

---

## 6. Persistence and dependency behaviour

### 6.1 Persistence map

| Data | Storage | Load/save functions | Notes |
|---|---|---|---|
| Accounts | SQLite (`accounts`) | `loadAccounts`, `saveSelectedAccounts` | |
| Categories | SQLite (`categories`) | `loadCategories`, `insertCategory`, `updateCategory`, `deleteCategory` | |
| Tags | SQLite (`tags`) | `loadTags`, `insertTag`, `updateTag`, `deleteTag` | |
| Rules | SQLite (`rules_v2`) | `loadRulesV2`, `insertRuleV2`, `updateRuleV2`, `deleteRuleV2` | |
| Budgets | SQLite (`category_budgets`) | `loadCategoryBudgets`, `upsertCategoryBudget` | |
| Budget overrides | SQLite (`category_budget_overrides`) | `loadBudgetOverrides`, `upsertBudgetOverride` | |
| Spending targets | SQLite (`spending_targets`) | `loadSpendingTargets`, `insertSpendingTarget`, `updateSpendingTarget`, `deleteSpendingTarget` | |
| Target overrides | SQLite (`spending_target_overrides`) | `loadTargetOverrides`, `upsertTargetOverride` | |
| Transactions | SQLite (`transactions`) | `loadRows`, `insertTransaction`, `updateTransaction*` | |
| Allocations | SQLite (`transaction_allocations`) | `loadTransactionAllocations`, `insertTransactionAllocation`, `updateTransactionAllocation*`, `deleteTransactionAllocation` | |
| Transaction tags | SQLite (`transaction_tags`) | `loadTransactionTags`, `addTagsToTransactions`, `removeTagFromTransactions` | |
| Allocation tags | SQLite (`transaction_allocation_tags`) | via `loadTransactionAllocations` join | |
| Imports | SQLite (`imports` table) | `loadImports` | |
| Import history | SQLite (via `imports` table) | `loadImports` | |
| Saved filters | TOML (`config.toml`) | `loadAppConfigExtended`, `saveSavedFilters` | |
| CSV formats | TOML (`~/.config/jaskmoney/formats.toml`) | `loadFormats` | External file |
| Keybindings | TOML (`keybindings.toml`) | `loadKeybindings` | |
| Chart settings | TOML (`config.toml`) | `loadAppConfigExtended`, `saveSettingsCmd` | `spendingWeekAnchor` |
| Dashboard custom modes | TOML (`config.toml`) | `loadAppConfigExtended` | `[[dashboard_view]]` blocks |
| UI state (cursor, tab, filters) | In-memory model only | N/A | Not persisted across restarts |
| Import preview snapshot | In-memory model only | N/A | Not persisted |

### 6.2 Dependency and deletion matrix

| Entity | Foreign key in | On delete of entity | On rename of entity |
|---|---|---|---|
| **Accounts** | `transactions.account_id` (ON DELETE CASCADE) | Cascades to transactions | No cascade (name used as label) |
| **Categories** | `transactions.category_id` (ON DELETE SET NULL) | Set NULL on transactions | No cascade (name used as label) |
| | `tags.category_id` (ON DELETE SET NULL) | Set NULL on scoped tags | |
| | `rules_v2.set_category_id` (ON DELETE SET NULL) | Set NULL on rules | |
| | `category_budgets.category_id` (ON DELETE CASCADE) | Cascades to budgets | |
| | `transaction_allocations.category_id` (ON DELETE SET NULL) | Set NULL on allocations | |
| **Tags** | `transaction_tags.tag_id` (ON DELETE CASCADE) | Cascades to junction rows | Normalises name to uppercase |
| | `transaction_allocation_tags.tag_id` (ON DELETE CASCADE) | Cascades to allocation tags | |
| | `rules_v2.add_tag_ids` (JSON array, no FK) | Stale reference (silently skipped) | Normalises name to uppercase |
| **Saved Filters** | `rules_v2.saved_filter_id` (TEXT, no FK) | Stale reference (rule skipped, shown as "filter:(missing)") | Effectively delete+create (stale references) |
| | `spending_targets.saved_filter_id` (TEXT, no FK) | Stale reference (computeTargetLines error) | |
| **Transactions** | `transaction_tags.transaction_id` (ON DELETE CASCADE) | Cascades to tags | N/A |
| | `transaction_allocations.parent_txn_id` (ON DELETE CASCADE) | Cascades to allocations | |
| **Rules** | (no FK to rules) | — | N/A |
| **Budgets** | `category_budget_overrides.budget_id` (ON DELETE CASCADE) | Cascades to overrides | N/A |
| **Targets** | `spending_target_overrides.target_id` (ON DELETE CASCADE) | Cascades to overrides | N/A |

**Soft references** (not enforced by FK): rules→saved filters, targets→saved filters, rules→tags (JSON array). These produce stale references that are visually flagged (red "filter:(missing)" labels) but do not crash the application.

---

## 7. Visual contract

### 7.1 Layout skeleton

The screen is composed of four stacked regions: **header**, **body**, **status bar**, **footer**. Every region is drawn as a full-width line (or set of lines) via `composeFrame`:

| Region | Height | Style/function |
|---|---|---|
| Header | 1 line | `renderHeader`: app name (`headerAppStyle`) + tab bar (`activeTabStyle`/`inactiveTabStyle` with `│` separator via `tabSepStyle`) + optional account label (`colorSubtext0`). Truncated via `ansi.Truncate` to fit `width - headerBarStyle.GetHorizontalFrameSize()`. Padded to full width by `headerBarStyle.Width(width)`. |
| Body | Remaining height | Content from the active tab, wrapped in cards/sections (see 7.2). |
| Status bar | 1 line | `renderStatus`: Normal text in `statusBarStyle` background. Error text (when `m.statusErr`) in `statusBarErrStyle` (red foreground). |
| Footer | 1 line | `renderFooter`: Keybinding hints for the active scope. Each hint built as `keyStyle` + space + `descStyle` with `colorMantle` background. Parts joined by double-space separator. Truncated to `width - footerStyle.GetHorizontalFrameSize()`. |

### 7.2 Card/section rendering (`renderSectionBoxWithPadding`)

Every pane is a titled box with rounded corners using `lipgloss.RoundedBorder()`:

```
╭── Title ──────────────────────────╮  ← top: `╭` + dashes + title + dashes + `╮`
│                                    │  ← separator line (if `withSeparator=true`):
│  ──────────────────────────────    │    `│` + padding + `─`*contentWidth + padding + `│`
│  content line 1                    │  ← `│` + padding + content(truncated+padRight) + padding + `│`
│  content line 2                    │
╰────────────────────────────────────╯  ← bottom: `╰` + `─`*innerWidth + `╯`
```

- `innerWidth = sectionWidth - 2` (excludes vertical borders `│`).
- `contentWidth = innerWidth - leftPad - rightPad`. Default `leftPad=1, rightPad=1`. Minimum `contentWidth=1`.
- Title rendered in `titleStyle` (or custom `titleSty`), centred in dashes, truncated if wider than `innerWidth`.
- Separator dash line uses `colorSurface2`.
- Border colour defaults to `colorSurface1`. Focused card gets accent-coloured border.

### 7.3 Modal rendering (`renderModalContentWithWidth`, `composeOverlay`)

**Modal content** (`renderModalContentWithWidth`):
- Title auto-centred in dashes (`╭── Title ──╮`), stripped of ANSI for width calculation.
- Body lines rendered with `modalTitleStyle`, body text, optional blank line + footer (`modalFooterStyle`).
- Content width: `fixedWidth` if > 0, else computed as max(title width, max body line width) clamped to `[18, 56]`.

**Overlay centering** (`composeOverlay`):
1. Build `baseView` from header + body + status + footer via `composeFrame`.
2. Wrap modal content in `modalStyle`.
3. Compute `modalWidth` = max line width in modal, `modalHeight` = line count.
4. Position: `x = (width - modalWidth) / 2`, `y = (targetHeight - modalHeight) / 2` where `targetHeight = height - 2`.
5. Render via `overlayAt(baseView, modal, x, y, width, targetHeight)` which overlays the modal string onto the base view at pixel coordinates.
6. Each output line normalized via `normalizeViewportLine`.

### 7.4 Narrow-terminal fallbacks

- Dashboard analytics: <80 cols → Net/Cashflow and Composition panes stack vertically instead of side-by-side.
- Manager account strip: truncates with `ansi.Truncate`.
- Settings columns: bounded (4 left, 3 right). No wrapping below minimum.

### 7.5 Truncation

ANSI-aware via `ansi.Truncate(string, maxWidth, "")` which respects ANSI escape sequences (colours, styles) within the string. Applied to:
- Header content (app name, tab bar, account label).
- Section titles in card headers.
- Transaction descriptions via `truncateTxnDescription`: shows `n-2` visible chars + `…` ellipsis.
- Account names, category names, tag names in constrained columns.

`padRight` pads a string to a fixed width with trailing spaces using ANSI-aware width measurement.

### 7.6 Known canonical screenshot dimensions

140×44 captures full Dashboard panels and footer consistently. 120×40 may clip lower Dashboard area.

### 7.7 Colour palette

Catppuccin Mocha (via `theme.go`). Exact hex values are implementation constants, not stable visual contract. Separated from layout rules which are stable.

---

## 8. MVP acceptance scenarios

### 8.1 Jump navigation

**Given** The application is running on any tab
**When** The user presses `v`
**Then — visible** A floating overlay appears with labelled key badges for each focusable section
**Then — visible** The underlying tab content remains visible behind the overlay
**When** The user presses a matching target key (e.g., `t` for Tags on Settings tab)
**Then — visible** The overlay disappears and focus moves to the tagged section
**Then — visible** The section is in active mode (cursor visible on first item)
**Preserved state** Cursor position, filter input, and selections in other sections are unchanged

### 8.2 Tab-state preservation

**Given** The user is on the Manager tab with a filter expression `cat:Food` typed, 3 transactions selected, and cursor at row 5
**When** The user presses `2` to switch to Budget tab, then `1` to return to Manager
**Then — visible** The filter input still shows `cat:Food`
**Then — visible** The same 3 transactions are still selected
**Then — visible** The cursor is at row 0 (reset on tab switch)
**Preserved state** Filter string, selected rows. **Not preserved**: cursor position.

### 8.3 Category assignment

**Given** A transaction in the Manager table has category "Uncategorised"
**When** The user moves cursor to that row and presses `c`
**Then — visible** A category picker overlay opens with all categories listed
**When** The user types `Gro` and presses Enter on "Groceries"
**Then — visible** The picker closes and the transaction now shows the "Groceries" badge
**Then — persisted** The transaction's `category_id` is updated in the database
**Preserved state** Cursor position, filter, and selections are unchanged

### 8.4 Range category assignment

**Given** The user is on the Manager tab with transactions visible
**When** The user presses `Shift+Down` to highlight a range of 3 rows
**Then — visible** The rows between anchor and cursor are highlighted
**When** The user presses `c` then selects a category
**Then — visible** All 3 highlighted rows now show the selected category badge
**Then — persisted** All 3 transactions have their `category_id` updated
**Preserved state** Range is cleared after the action

### 8.5 Mixed-state tag editing

**Given** 3 transactions are selected, where 2 have tag "Coffee" and none have tag "Groceries"
**When** The user presses `t`
**Then — visible** The tag picker shows "Coffee" in indeterminate state (Some), "Groceries" unchecked (None)
**When** The user presses Space on "Coffee" (toggles to None) and Space on "Groceries" (toggles to All), then Enter
**Then — visible** Picker closes. All 3 rows: "Coffee" tag removed, "Groceries" tag added.
**Then — persisted** Transaction_tags junction table updated: Coffee removed from all 3, Groceries added to all 3.
**Preserved state** Selection preserved, cursor preserved

### 8.6 Filter typing and saving

**Given** The user is on the Manager tab
**When** The user presses `/` and types `cat:Food OR amt:>50`
**Then — visible** The transaction table filters to matching rows
**Then — visible** The filter pill shows the parsed expression
**When** The user activates the filter save action (via command palette or command)
**Then — visible** A filter editor modal opens with the expression pre-filled
**When** The user enters a filter ID and name and confirms
**Then — visible** The editor closes. A status message confirms the filter was saved.
**Then — persisted** The filter is saved to `config.toml`
**Preserved state** The filter remains active on Manager

### 8.7 Invalid saved filter

**Given** The user is editing a saved filter with a valid expression
**When** The user changes the expression to an invalid value (e.g., `amt:abc` or mixed AND/OR without parentheses)
**Then — visible** The expression state indicator shows "invalid" (red). A parse error message is displayed in the editor.
**Then — visible** The save action is blocked — the editor remains open.
**Preserved state** The editor fields retain the typed values

### 8.8 Referenced-filter deletion

**Given** A rule named "Groceries Rule" references saved filter `groceries-filter`
**When** The user deletes `groceries-filter` from Settings > Filters
**Then — visible** The filter is removed from the list with confirmation
**Then — visible** The rule "Groceries Rule" now shows `filter:(missing)` in red
**Then — persisted** The rule's `saved_filter_id` still references the deleted filter (no cascade)
**When** The user runs Apply Rules
**Then — visible** The rule is skipped and counted as a failed rule
**Preserved state** Rule is unchanged in DB

### 8.9 Rule Dry Run and Apply

**Given** A rule "Coffee Categoriser" matches transactions containing "coffee" and sets category "Coffee & Tea"
**When** The user navigates to Settings > Rules, selects the rule, and presses `D` (Dry Run)
**Then — visible** A Dry Run result modal shows: scope label, match count, affected transactions, category/tag changes
**Then — persisted** No changes written to database
**When** The user presses `A` (Apply)
**Then — visible** A status message shows applied/failed/skipped counts
**Then — persisted** All matching transactions' categories updated in a single transaction

### 8.10 Import duplicates

**Given** A CSV file contains a row matching an existing transaction (same date, amount, description, account)
**When** The user opens the CSV via import
**Then — visible** The import preview shows duplicate rows flagged with an indicator. The "Duplicate Rows" view lists them.
**When** The user confirms import with `import:skip-dupes`
**Then — visible** A status message shows the count of imported transactions and duplicates skipped.
**Then — persisted** Only non-duplicate rows inserted
**Preserved state** Transaction table refreshes showing new rows

### 8.11 Import parse failure

**Given** A CSV file has a row with invalid date format
**When** The user opens the CSV via import
**Then — visible** The import preview shows an error block with a message indicating the import is blocked. The first several parse errors are listed with line numbers and field names.
**When** The user tries to confirm import
**Then — visible** The import commands are disabled — the preview has a non-zero error count.

### 8.12 Allocation creation

**Given** A debit transaction for $100.00 has no allocations
**When** The user presses Enter on the transaction and activates "Create allocation"
**Then — visible** An allocation modal opens with amount and note fields
**When** The user enters $60.00 and "Split 1" and presses Enter
**Then — visible** The modal closes. The parent now shows $40.00 (remainder). A child row shows "$60.00" with "↳" prefix.
**Then — persisted** A `transaction_allocations` row is inserted
**Preserved state** Cursor position, filter unchanged

### 8.13 Over-allocation rejection

**Given** A debit transaction for $100.00 already has an allocation of $70.00 (remainder $30.00)
**When** The user creates a second allocation of $50.00
**Then — visible** The allocation modal shows an error status indicating the allocation exceeds the remaining parent capacity.
**Then — visible** The modal remains open, the amount is not saved.
**Then — persisted** No new allocation row inserted
**Preserved state** The modal retains the entered amount and note text

### 8.14 Budget override

**Given** Category "Groceries" has a default budget of $500
**When** The user switches to Planner view on Budget tab, navigates to March, and enters $600 for Groceries
**Then — visible** The March cell for Groceries shows "$600 *" (asterisk indicating override)
**Then — visible** The Table view also reflects $600 for March
**Then — persisted** A `category_budget_overrides` row is inserted for March
**When** The user presses `budget:reset-override`
**Then — visible** The cell reverts to $500 (default) and the asterisk disappears
**Then — persisted** The override row is deleted

### 8.15 Spending target

**Given** A saved filter "Eating Out" exists with expression `cat:Dining`
**When** The user creates a spending target with amount $200, period "monthly", referencing "Eating Out"
**Then — persisted** A `spending_targets` row is inserted
**Then — visible** The Spending Targets section on Budget tab shows the new target with $200 budgeted
**When** The user has $150 in Dining transactions for the month
**Then — visible** The target line shows $150 spent, $50 remaining

### 8.16 Dashboard drill and return

**Given** The Dashboard shows analytics with "Net/Cashflow" pane focused
**When** The user presses Enter on the Net/Cashflow pane
**Then — visible** The view switches to Manager tab with filter showing "[Dashboard >]"
**Then — visible** The transaction table is filtered to the drill predicate (e.g., `type:debit OR type:credit`)
**Preserved state** The previous Manager filter is saved in `drillReturn`
**When** The user presses Esc
**Then — visible** The view returns to Dashboard, the same pane is focused, the Manager filter is restored

### 8.17 Account-scope propagation

**Given** Three accounts exist: Checking, Savings, Credit Card
**When** The user deselects "Credit Card" from the accounts strip in Manager
**Then — visible** The accounts strip shows "2 selected" label
**Then — visible** The transaction table filters to only Checking and Savings transactions
**When** The user switches to Dashboard
**Then — visible** Dashboard data also reflects only Checking and Savings
**When** The user switches to Budget tab
**Then — visible** Budget calculations use only Checking and Savings transactions
**Preserved state** Account scope persists across restarts

### 8.18 Destructive Settings confirmation

**Given** The user is in Settings > Categories with a non-default category focused
**When** The user presses `del`
**Then — visible** No immediate change (first del arms the delete)
**When** The user presses `del` again within ~2 seconds
**Then — visible** The category is removed from the list
**Then — persisted** The category is deleted from the database
**When** The user had transactions in that category
**Then — persisted** Those transactions' `category_id` is set to NULL

---

## 9. Unresolved contradictions

| Topic | Current code | Tests | Specs | Likely behaviour | Confidence | Runtime check needed |
|---|---|---|---|---|---|---|
| Budget `credit_offsets`/`manual_offsets` | Dropped by `ensureRuntimeSchemaCompatibility`. Code uses allocations only. | No tests for legacy offsets. | Specs reference offset accounting in budget calculations. | Allocations are the only adjustment mechanism. | High | Run `-startup-check` to confirm schema migration. |
| Dashboard v2 2x2 grid vs. 2 panes | Lower analytics has 2 panes (Net/Cashflow + Composition), not 2x2. | Tests confirm 2-pane layout. | Phase 6 spec describes 2x2 grid. | Simplified during implementation. | High | Visual inspection. |
| `settings:nuke-account` command | Listed as deprecated in spec. Manager account modal replaces it. | No test for nuke-account. | Spec marks it deprecated. | Functionality moved to Manager. | High | Check command registry for presence. |
| `spendingTarget` period enum | Loaded from DB but validation of `loadedPeriod` vs expected bounds is done at query time, not insert time. | Tests exist for compute. | Spec describes period type enum. | Validated at compute time, not at insert time. | Medium | Check `insertSpendingTarget` for period validation. |
| Rule editor `sort_order` tiebreaker | No explicit tiebreaker for rules with same `sort_order`. | No test for equal sort_order. | Spec implies deterministic order. | Undefined ordering between equal sort_order rules (database query order). | Medium | No runtime check currently possible. |
| Import intra-file duplicate | Detects duplicates within the same CSV file (second occurrence of identical row marked as dupe). | `TestImportCSVDuplicatesWithinSameFile` confirms. | Spec does not detail intra-file detection. | Correct behaviour. | High | Already tested. |
| `filterLastApplied` semantics | Set by `parseFilterStrict` in `update_filterInput`. Used for canonical display. Not same as `filterExpr`. | Tests confirm filter-save requires applied expression. | Spec does not distinguish applied vs. live expression. | `filterLastApplied` is the canonical form saved/displayed; `filterExpr` is live. | High | Check `saveFilterEditor` usage. |
| Catppuccin colour constants | Exact hex values in `theme.go`. | Snapshot tests reference specific colours. | No spec for exact colours. | Implementation detail, not contractual. | High | Colour changes acceptable without invariant update. |

---

## 10. Source evidence

### Section 2 — Global interaction contract
- `update.go`: `model.Update`, `applyTabDefaultsOnSwitch`, `updateJumpOverlay`, `jumpTargetsForActiveTab`, `applyFocusedSection`
- `dispatch.go`: `overlayPrecedence`, `activeOverlayScope`, `activeInteractionContract`, `renderFooterFromContract`, `interactionContracts` map, `modalTextContracts`
- `keys.go`: `executeBoundCommand`, `NewKeyRegistry`
- `commands.go`: `NewCommandRegistry`, `Command` struct
- `update_manager.go`: drill-down return logic, `quickActionTargets`, `splitRowTargets`
- `update_transactions.go`: `pruneSelections`, `ensureRangeSelectionValid`, `indexInFiltered`
- `app.go`: model fields `cursor`, `selectedRows`, `rangeSelecting`, `rangeAnchorID`, `rangeCursorID`, `focusedSection`
- Tests: `resilience_test.go`, `update_mode_test.go`, `keys_test.go`, `dispatch_test.go`

### Section 3.1 — Dashboard
- `render.go`: `dashboardView`, `renderDashboardWidgetPane`, `renderDashboardWidgetModeContent`, `renderSpendingTrackerWithRange`
- `update_dashboard.go`: `buildDashboardScopeFilter`, drill predicate construction, `captureDrillReturn`
- `app.go`: `dashTimeframe`, `dashCustomStart`, `dashCustomEnd`, `dashWidgets`, `dashPeriodAnchor`
- Tests: drill-return lifecycle tests

### Section 3.2 — Budget
- `budget.go`: `computeBudgetLines`, `computeTargetLines`, `queryEffectiveSpendByCategory`
- `update_budget.go`: `updateBudget`, `moveBudgetCursor`, `updateBudgetEdit`, `budgetDeleteConfirmTimerCmd`
- `render.go`: `renderBudgetTable`, `renderBudgetPlanner`, `renderBudgetPlannerGrid`
- `db.go`: `loadCategoryBudgets`, `upsertCategoryBudget`, `loadBudgetOverrides`, `upsertBudgetOverride`, `loadSpendingTargets`, `loadTargetOverrides`, `upsertTargetOverride`
- `app.go`: `budgetView`, `budgetMonth`, `budgetYear`, `budgetCursor`, `budgetPlannerCol`, `budgetEditing`, `budgetEditValue`

### Section 3.3 — Manager
- `update_detail.go`: `openDetail`, `closeDetail`, `updateDetail`, `updateDetailNotes`
- `update_transactions.go`: `openQuickCategoryPicker`, `openQuickTagPicker`, `quickActionTargets`, `splitRowTargets`, `applyCategoryToRowTargets`, `addTagsToRowTargets`, `removeTagFromRowTargets`, `closeAllocationAmountModal`, `updateAllocationAmountModal`
- `update_manager.go`: `updateMain`, `updateManager`, `persistManagerAccountScopeCmd`, `updateManagerModal`, `updateManagerActionPicker`
- `render.go`: `renderTransactionTable`, `renderDetailWithAllocations`, `renderDetailCore`
- `picker.go`: `pickerState`, `PendingTagPatch`, `SetTriState`, `HasPendingChanges`
- `filter.go`: `parseFilter`, `parseFilterStrict`, `evalFilter`, `renderFilterNode`
- Tests: `TestPhase5QuickTagEnterAppliesAllDirtyChanges`, `TestRuleTagPickerEnterNoPendingTogglesAndCloses`, `TestTransactionAllocationCapacityValidation`

### Section 3.4 — Settings
- `update_settings.go`: `updateSettings`, `updateSettingsActive`, `updateSettingsCategories`, `updateSettingsTags`, `updateSettingsRules`, `updateSettingsFilters`, `updateSettingsDBImport`, `updateSettingsChart`, `updateSettingsConfirm`, `updateSettingsTextInput`, `openRuleEditor`, `openRuleFilterPicker`, `openRuleCategoryPicker`, `openRuleTagPicker`, `updateRuleEditor`, `updateDryRunModal`
- `render.go`: `renderSettingsContent`, `renderSettingsCategories`, `renderSettingsTags`, `renderSettingsChart`, `renderSettingsDBImport`, `renderSettingsImportHistory`, `renderDryRunResultsModal`
- `app.go`: `settColumn`, `settSection`, `settActive`, `settItemCursor`, `settMode`, `settInput`, `settColorIdx`, `settCatFocus`, `settTagScopeID`

### Section 4 — Domain invariants
- `db.go`: schema definitions, `loadTransactionAllocations`, `insertTransactionAllocation`, `updateTransactionAllocationAmountAndNote`, `deleteTransactionAllocation`, `remainingAllocationCapacityTx`, `normalizeAllocationAmount`, `buildAccountScopeFilter`, `applyResolvedRulesV2ToRows`, `dryRunRulesV2`, `applyRulesV2ToScope`, `resolveRulesV2`, `handleRefreshDone`, `refreshCmd`
- `budget.go`: `computeBudgetLines`, `computeTargetLines`, `queryEffectiveSpendByCategory`
- `filter.go`: `parseFilter`, `parseFilterStrict`, `evalFilter`, `validateStrictGrouping`, `fallbackPlainTextFilter`
- `ingest.go`: `duplicateKeyForAccount`, `loadDuplicateSet`, `countDuplicatesForAccount`, `importPreviewSnapshot`, `buildImportPreviewSnapshot`, `ingestSnapshotCmd`, `importCSVForAccountWithTxnIDs`
- Tests: `TestDeleteCategoryNullsTransactions`, `TestImportCSVBadRowRollsBackNoPartialWrites`, `TestImportCSVForAccountDuplicateDetectionIsAccountScoped`, `TestImportCSVDuplicatesWithinSameFile`, `TestApplyRulesV2ToScope_OrderCategoryAndTagSemantics`

### Section 5 — Cross-screen state and data flow
- `update_dashboard.go`: `buildDashboardScopeFilter`
- `update_manager.go`: `getFilteredRows`, `buildTransactionFilter`
- `db.go`: `buildAccountScopeFilter`, `applyRulesV2ToScope`, `queryEffectiveSpendByCategory`
- `app.go`: `drillReturnState`, `filterAccounts`, `filterInput`, `filterExpr`, `drillReturn`

### Section 6 — Persistence and dependency behaviour
- `db.go`: all `CREATE TABLE` statements with foreign key constraints, `loadAppConfigExtended`, `parseConfigExt`
- `config.go`: `loadAppConfigExtended`, `saveSavedFilters`, `saveSettingsCmd`
- `filter_saved.go`: `loadAppConfigExtended`, `normalizeFilterConfigEntries`
- `db.go` schema lines 75–173 for all `ON DELETE` constraints

### Section 7 — Visual contract
- `render.go`: `renderHeader`, `renderFooter`, `renderStatus`, `renderSectionBoxWithPadding`, `sectionBoxContentWidth`, `renderTransactionTable`, `renderDetailWithAllocations`, `renderModalContent`, `renderModalContentWithWidth`, `renderBudgetTable`, `renderBudgetPlanner`, `dashboardView`, `renderSettingsContent`, `composeOverlay`
- `theme.go`: Catppuccin Mocha colour constants
- `app.go`: `renderFooter`, `renderStatus`

### Section 8 — MVP acceptance scenarios
- Derived from all tested invariants above. Specific test references in each scenario's production path.

### Section 9 — Unresolved contradictions
- Cross-referenced between: `db.go` (ensureRuntimeSchemaCompatibility), `specs/v0.4-spec.md`, `specs/primatives_report.md`, `update_budget.go`, `update_settings.go`
