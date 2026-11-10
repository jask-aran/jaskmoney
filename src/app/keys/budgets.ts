import { travel } from "../paneTravel"
import { type Hint } from "../palette"
import { settleData } from "../actions"
import { type KeyEvent } from "@opentui/core"
import { budgetLabel, budgetScopeOptions, scopeKey } from "../../domain/budgetScopes"
import { usualPay } from "../../domain/payday"
import { budgetIgnoredIds, cycleAt, type Budget, type BudgetScope } from "../../domain/budget"
import { budgetArmId, budgetSetupRows, overallAverage, type BudgetLine, type SetupRow } from "../../domain/budgetLines"
import { sharedBudgetView, sharedCategoryLines } from "../../state/budgetViews"
import { BUDGET_PANES, BUDGET_VIEWS, CATEGORIES, budgetListInPane, budgetsHome, cycleViewsFor, type ScopeId, type UiStore } from "../../state/uiStore"
import type { DataStore } from "../../state/dataStore"
import { appToday } from "../../domain/days"
import { shortDate } from "../../ui/text"
import { listMove, confirmTwice, type HintState, type ScopeEntry, tabWide, cycleDraft } from "./shared"

/** The cycle the Budgets tab shows and the budgets in force in it. */
export function viewedBudgets(ui: UiStore, data: DataStore) {
  return sharedBudgetView(data.cycle(), appToday(), ui.state.activeTab === "budgets" ? ui.state.budgetOffset : 0, data.state.budgetHistory, data.state.budgets)
}

/** The Categories card's lines, as the tab draws them. */
function budgetLines(ui: UiStore, data: DataStore): BudgetLine[] {
  const view = viewedBudgets(ui, data)
  return sharedCategoryLines(data.cycle(), view.through, data.state.accounts, data.state.categories, view.budgets, data.transactions())
}

function openBudgetEditor(ui: UiStore, data: DataStore, budget: Budget | null, scope: BudgetScope, amount: number): void {
  ui.openSettingsEditor("budget", budget?.id ?? null, { ...ui.state.settingsDraft, ...cycleDraft(data.state.budgetCycle), scopeKey: scopeKey(scope), amount: budget ? String(budget.amount) : amount > 0 ? String(Math.round(amount)) : "" })
}

/** Steps one of the Budgets tab's chart panes through its views: the
 * budget pane (0) through BUDGET_VIEWS, a cycle pane (1, 2) through
 * CYCLE_VIEWS. */
function stepBudgetPane(ui: UiStore, pane: number, step: number): void {
  if (pane === 0) { ui.setState({ budgetChart: (ui.state.budgetChart + step + BUDGET_VIEWS.length) % BUDGET_VIEWS.length }); return }
  // A cycle pane steps through its views (the first's the list, then
  // CYCLE_VIEWS); focus on the first follows it between the list and a chart.
  const order = cycleViewsFor(pane - 1)
  const views: [number, number] = [...ui.state.budgetCycleViews]
  const at = Math.max(0, order.indexOf(views[pane - 1]!))
  views[pane - 1] = order[(at + step + order.length) % order.length]!
  const focused = ui.state.focusedSection
  const onPane = pane === 1 && (focused === "bud.cycle" || (focused === "bud.categories" && budgetListInPane(ui.state)))
  ui.setState({ budgetCycleViews: views, ...(onPane ? { focusedSection: views[0] === CATEGORIES ? "bud.categories" : "bud.cycle" } : {}) })
}

/** Keys every Budgets card and pane shares: ←/→ move between panes; h/l
 * step the focused chart pane's views (the budget pane's from the cards),
 * H/L the cycle pane's;
 * [ and ] show the cycle before or after (up to this one, back to the
 * first with data); c edits the cycle. */
function budgetKeys(ui: UiStore, key: KeyEvent, data: DataStore, pane = 0): boolean {
  const { name, sequence: seq } = key
  if (name === "[" || seq === "[" || name === "]" || seq === "]") {
    const back = name === "[" || seq === "["
    const first = data.transactions().reduce((min, t) => (t.dateISO < min ? t.dateISO : min), appToday())
    const offset = ui.state.budgetOffset + (back ? -1 : 1)
    if (offset > 0) { ui.setStatus("This is the current cycle"); return true }
    if (back && cycleAt(data.cycle(), appToday(), offset).end < first) { ui.setStatus("No cycles before this one have data", true); return true }
    ui.setState({ budgetOffset: offset })
    return true
  }
  if ((seq === "H" || seq === "L") && ui.state.budgetCyclePanes > 0) {
    stepBudgetPane(ui, 1, seq === "H" ? -1 : 1)
    return true
  }
  // ←/→ move between panes, as on the Overview; h/l step views.
  if (name === "left" || name === "right") { travel(ui, name, data); return true }
  if (name === "h" || name === "l") {
    stepBudgetPane(ui, pane, name === "h" ? -1 : 1)
    return true
  }
  if (name === "c") { ui.openSettingsEditor("cycle", null, { ...ui.state.settingsDraft, ...cycleDraft(data.state.budgetCycle) }); return true }
  return false
}

/** A Budgets chart pane: h/l its views, j/k and the arrows to the pane
 * or card in that direction, [ ] and c as on the cards, esc back to
 * the budgets. */
function handleBudgetChart(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  if (!data) return
  if (name === "escape") { ui.setState({ focusedSection: budgetsHome(ui.state) }); return }
  if (name === "j" || name === "down") { travel(ui, "down", data); return }
  if (name === "k" || name === "up") { travel(ui, "up", data); return }
  budgetKeys(ui, key, data, Math.max(0, BUDGET_PANES.indexOf(ui.state.focusedSection)))
}

/** The Budgets pane's rows, as the tab draws them. */
function setupRows(ui: UiStore, data: DataStore): SetupRow[] {
  return budgetSetupRows(budgetLines(ui, data), new Set(ui.state.budgetSetupOpen), viewedBudgets(ui, data).budgets)
}

/** The Budgets pane's keys, from it or the list: p your pay, t the
 * overall spending target, a a new budget, s the flow's view. */
function budgetPlanKeys(ui: UiStore, key: KeyEvent, data: DataStore): boolean {
  const { name } = key
  const view = viewedBudgets(ui, data)
  // Your pay each payday, from your usual pay (empty clears it).
  if (name === "p" && !key.shift) {
    const start = data.state.uiPrefs.expectedPay || usualPay(data.state.accounts, data.transactions())
    ui.openSettingsEditor("pay", null, { ...ui.state.settingsDraft, amount: start ? String(Math.round(start)) : "" })
    return true
  }
  // The overall spending target, a new one from its average.
  if (name === "t" && !key.shift) {
    const overall = view.budgets.find((b) => b.scope.kind === "overall") ?? null
    openBudgetEditor(ui, data, overall, { kind: "overall" }, overallAverage(budgetLines(ui, data), budgetIgnoredIds(data.state.categories)))
    return true
  }
  // s: the flow over the categories opens out to where the spending went,
  // or where the net went (the Overview's Range pane's view too).
  if (name === "s" && !key.shift && !key.ctrl && !key.meta) {
    const spending = data.state.uiPrefs.rangeView !== "spending"
    settleData(ui, data.saveUiPrefs({ rangeView: spending ? "spending" : "net" }), () => ui.setStatus(spending ? "Where the spending went" : "Where the net went"))
    return true
  }
  // a: a new budget, on whatever it covers (the first scope without one).
  if (name === "a" && !key.shift) {
    const taken = new Set(data.state.budgets.map((b) => scopeKey(b.scope)))
    const free = budgetScopeOptions(data.state.accounts, data.state.categories).find((o) => !taken.has(o.key))
    ui.openSettingsEditor("budget", null, { ...ui.state.settingsDraft, ...cycleDraft(data.state.budgetCycle), scopeKey: free?.key ?? "overall", amount: "" })
    return true
  }
  return false
}

/** The Budgets pane (the list in the cycle pane): its keys, j/k to the
 * pane in that direction. */
function handleBudgetPlan(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  if (!data) return
  if (budgetKeys(ui, key, data) || budgetPlanKeys(ui, key, data)) return
  if (name === "j" || name === "down") { travel(ui, "down", data); return }
  if (name === "k" || name === "up") travel(ui, "up", data)
}

/** The Budgets tab's Budgets pane: p sets your pay each payday (from your
 * usual pay), t the overall spending target (a new one from its average),
 * a adds a budget on anything; enter sets or edits the budget of the row
 * at the cursor (All spending: the target; a new category's starts from
 * its average: allocating down), space opens or closes a group, del twice
 * removes a budget, x leaves a category out of the overall budget (or
 * brings it back); k past the top goes to the pane above. */
function handleBudgetCategories(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  if (!data) return
  // h/l: in the cycle pane, its views (the list's the first); in the
  // Budgets pane, the budget chart's.
  if (budgetKeys(ui, key, data, budgetListInPane(ui.state) ? 1 : 0) || budgetPlanKeys(ui, key, data)) return
  // In the cycle pane, esc home (the Budgets pane), as from a chart.
  if (name === "escape" && budgetListInPane(ui.state)) { ui.setState({ focusedSection: budgetsHome(ui.state) }); return }
  const view = viewedBudgets(ui, data)
  const rows = setupRows(ui, data)
  const cursor = Math.min(ui.state.budgetCategoryCursor, Math.max(0, rows.length - 1))
  // Above the first row: the pane in that direction.
  if ((name === "k" || name === "up") && cursor === 0) { travel(ui, "up", data); return }
  const moved = listMove(key, cursor, rows.length)
  if (moved != null) { ui.setState({ budgetCategoryCursor: moved }); return }
  const row = rows[cursor]
  if (!row) return
  const removeTwice = (budget: Budget, label: string) =>
    confirmTwice(ui, data, { kind: "budget", id: budgetArmId(budget, view.cycle.start), label: `the ${label} budget${view.current ? "" : ` from ${shortDate(view.cycle.start)}`}`, with: "delete" })
  // All spending: the overall spending target (as t); del twice removes it.
  if (row.kind === "total") {
    const overall = view.budgets.find((b) => b.scope.kind === "overall") ?? null
    if (name === "return" || name === "enter") openBudgetEditor(ui, data, overall, { kind: "overall" }, overallAverage(budgetLines(ui, data), budgetIgnoredIds(data.state.categories)))
    else if ((name === "delete" || name === "backspace") && overall) removeTwice(overall, "overall spending target's")
    return
  }
  if (row.kind === "account") {
    if (name === "return" || name === "enter") openBudgetEditor(ui, data, row.budget, row.budget.scope, row.budget.amount)
    else if (name === "delete" || name === "backspace") removeTwice(row.budget, budgetLabel(row.budget, data.state.accounts, data.state.categories))
    return
  }
  const line = row.line
  if (name === "space" || key.sequence === " ") {
    if (row.open === null || line.categoryId === null) return
    const id = line.categoryId
    ui.setState({ budgetSetupOpen: row.open ? ui.state.budgetSetupOpen.filter((g) => g !== id) : [...ui.state.budgetSetupOpen, id] })
    return
  }
  if (name === "x") {
    const category = data.state.categories.find((c) => c.id === line.categoryId)
    if (!category) { ui.setStatus("Uncategorised always counts: categorise its rows first", true); return }
    const group = category.parentId == null ? undefined : data.state.categories.find((c) => c.id === category.parentId)
    if (group?.budgetIgnored) { ui.setStatus(`Left out with ${group.name}: x on ${group.name} brings it back`, true); return }
    // Read before the change: the store's category shows the new value once it's made.
    const wasIgnored = category.budgetIgnored
    settleData(ui, data.setCategoryBudgetIgnored(category.id, !wasIgnored), () => ui.setStatus(wasIgnored ? `${category.name} counts toward the overall budget again` : `${category.name} left out of the overall budget`))
    return
  }
  if (name === "return" || name === "enter") {
    if (line.categoryId === null) { ui.setStatus("Uncategorised can't have a budget: categorise its rows first", true); return }
    openBudgetEditor(ui, data, line.budget, { kind: "category", categoryId: line.categoryId }, line.average || line.now)
    return
  }
  if ((name === "delete" || name === "backspace") && line.budget) {
    confirmTwice(ui, data, { kind: "budget", id: budgetArmId(line.budget, view.cycle.start), label: `the ${line.name} budget${view.current ? "" : ` from ${shortDate(view.cycle.start)}`}`, with: "delete" })
  }
}

/** The Budgets pane's own keys: your pay, the target and the flow's view. */
const budgetPlanHints = (state?: HintState): Hint[] => [{ key: "p", desc: "pay" }, { key: "t", desc: "target" }, { key: "s", desc: state?.rangeView === "spending" ? "net view" : "spending view", label: "Flow: where the spending or the net went" }]

/** H/L steps the Budgets tab's cycle pane, while one is on screen. */
const cycleChartHint = (state?: HintState) => ((state?.budgetCyclePanes ?? 1) > 0 ? [{ key: "H/L", desc: "cycle chart" }] : [])

export const budgetsScopes = {
  "budgets.chart": {
    handle: handleBudgetChart,
    list: true,
    pane: (state) => (state?.focusedSection === "bud.cycle" ? "Cycle chart" : state?.focusedSection === "bud.cycle2" ? "Second cycle chart" : "Budget chart"),
    hints: (state) => [{ key: "h/l", desc: "view" }, ...cycleChartHint(state).filter(() => state?.focusedSection === "bud.chart"), ...tabWide([{ key: "j/k", desc: "panes" }, { key: "[ ]", desc: "cycles" }, { key: "c", desc: "cycle" }, { key: "esc", desc: "budgets" }, { key: "v", desc: "jump" }, { key: "1-4", desc: "tab" }])],
  },
  "budgets.categories": {
    handle: handleBudgetCategories,
    list: true,
    // In the cycle pane, the list is its Categories view; else it's the
    // Budgets pane's, under the plan.
    pane: (state) => (state?.budgetListInPane ? "Categories" : "Budgets"),
    hints: (state) => [{ key: "j/k", desc: "move" }, { key: "enter", desc: "set budget" }, { key: "space", desc: "open" }, { key: "x", desc: "leave out" }, { key: "del del", desc: "remove budget" }, { key: "a", desc: "add" }, ...(state?.budgetListInPane ? [{ key: "h/l", desc: "view" }] : []), ...tabWide([...budgetPlanHints(state), { key: "[ ]", desc: "cycles" }, { key: "c", desc: "cycle" }, ...(state?.budgetListInPane ? [{ key: "esc", desc: "budgets" }] : [{ key: "h/l", desc: "chart" }, ...cycleChartHint(state)]), { key: "v", desc: "jump" }, { key: "1-4", desc: "tab" }])],
  },
  "budgets.plan": {
    handle: handleBudgetPlan,
    list: true,
    pane: () => "Budgets",
    hints: (state) => [...budgetPlanHints(state), { key: "a", desc: "add" }, ...tabWide([{ key: "[ ]", desc: "cycles" }, { key: "c", desc: "cycle" }, { key: "h/l", desc: "chart" }, ...cycleChartHint(state), { key: "v", desc: "jump" }, { key: "1-4", desc: "tab" }])],
  },
} satisfies Partial<Record<ScopeId, ScopeEntry>>

