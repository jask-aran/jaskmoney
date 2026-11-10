import { travel } from "../paneTravel"
import { type Hint } from "../palette"
import { changeAccountScope, toTransactions, settleData } from "../actions"
import { type KeyEvent } from "@opentui/core"
import { accountRole } from "../../domain/types"
import { spendingScope, type AccountSelection } from "../../domain/accountTree"
import { type CycleConfig } from "../../domain/budget"
import { toggleUncategorised } from "../suggest"
import { CHART_VIEWS, chartPaneOf, type ChartViews, type ScopeId, type UiState, type UiStore } from "../../state/uiStore"
import type { DataStore } from "../../state/dataStore"
import { CUSTOM_CHIP, LOOKBACKS, PERIOD_LABEL, activeChipIndex, applyChip, chipCount, chipLabel, stepChip, readCustomRange, rangeOffsetLabel, stepRange, timeframeBounds, timeframeNow, type TimeframeState } from "../../domain/timeframe"
import { editText, textField } from "../../domain/textField"
import { appNow, appToday } from "../../domain/days"
import { rangeDayFromText, rangeDayText } from "../../domain/typedInput"
import { CALENDAR_VIEWS, CUSTOM_FOCUS_ORDER, leftHalf, markedRange, moveCursor, pageCursor, rowStep, unitOf, type CalendarView, type CustomFocus } from "../../domain/rangeCalendar"
import { drillFilter } from "../../domain/drill"
import type { CategoryLine } from "../../domain/dashboard"
import { openGroups, overviewCategoryLines, overviewRange } from "../../state/overviewRange"
import { count } from "../../ui/text"
import { listMove, shifted, isSmartSearchKey, openSmartSearch, moveOverviewCategory, type HintState, type ScopeEntry, tabWide } from "./shared"

function applyCustomRange(ui: UiStore, start: string, end: string): void {
  const tf: TimeframeState = { ...ui.state.timeframe, family: "custom", custom: { start, end } }
  ui.setTimeframe(tf)
  ui.setState({ customEdit: null })
  ui.setDashChipCursor(CUSTOM_CHIP)
  const read = readCustomRange(start, end, appToday())
  ui.setStatus("error" in read ? "Custom range" : `Custom · ${read.label} · [ ] step by ${read.days} days`)
}

type CustomEdit = NonNullable<UiState["customEdit"]>

function moveCustomCursor(ui: UiStore, edit: CustomEdit, cursor: string, view = edit.view): void {
  const range = edit.mark ? markedRange(edit.mark, cursor, view) : null
  ui.setState({ customEdit: { ...edit, cursor, view, error: "", ...(range ? { start: textField(rangeDayText(range.start)), end: textField(rangeDayText(range.end)) } : {}) } })
}

export function markCustomCell(ui: UiStore, cursor: string): void {
  const edit = ui.state.customEdit
  if (!edit) return
  if (edit.mark) {
    const range = markedRange(edit.mark, cursor, edit.view)
    applyCustomRange(ui, range.start, range.end)
    return
  }
  const unit = unitOf(cursor, edit.view)
  ui.setState({ customEdit: {
    ...edit, focus: "grid", cursor, error: "", mark: unit,
    before: { start: edit.start.value, end: edit.end.value },
    start: textField(rangeDayText(unit.start)), end: textField(rangeDayText(unit.end)),
  } })
  ui.setStatus(`From ${rangeDayText(unit.start)} · enter (or a click) where it ends · esc undoes`)
}

export function setCustomView(ui: UiStore, view: CalendarView): void {
  const edit = ui.state.customEdit
  if (edit) moveCustomCursor(ui, edit, edit.cursor, view)
}

export function pageCustomCalendar(ui: UiStore, delta: -1 | 1): void {
  const edit = ui.state.customEdit
  if (edit) moveCustomCursor(ui, edit, pageCursor(edit.cursor, edit.view, delta))
}

function handleOverviewCustom(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  const seq = key.sequence
  const edit = ui.state.customEdit
  if (!edit) return
  if (name === "escape") {
    if (edit.mark && edit.before) { ui.setState({ customEdit: { ...edit, mark: null, before: null, start: textField(edit.before.start), end: textField(edit.before.end) } }); ui.setStatus("Mark undone"); return }
    ui.setState({ customEdit: null }); ui.setStatus("Range unchanged"); return
  }
  const today = appToday()
  const go = (focus: CustomFocus) => ui.setState({ customEdit: { ...edit, focus, error: "", ...(focus === "from" ? { start: textField(edit.start.value) } : focus === "to" ? { end: textField(edit.end.value) } : {}) } })
  if (name === "tab") {
    const at = CUSTOM_FOCUS_ORDER.indexOf(edit.focus)
    go(CUSTOM_FOCUS_ORDER[(at + (key.shift ? -1 : 1) + CUSTOM_FOCUS_ORDER.length) % CUSTOM_FOCUS_ORDER.length]!)
    return
  }
  const left = name === "left", right = name === "right"
  if (edit.focus === "page") {
    if (left || right) pageCustomCalendar(ui, left ? -1 : 1)
    else if (name === "down") go("grid")
    return
  }
  if (edit.focus === "views") {
    if (left || right) {
      const at = CALENDAR_VIEWS.indexOf(edit.view)
      setCustomView(ui, CALENDAR_VIEWS[Math.max(0, Math.min(CALENDAR_VIEWS.length - 1, at + (left ? -1 : 1)))]!)
    } else if (name === "down") go("grid")
    return
  }
  if (edit.focus === "grid") {
    if (left || right) { moveCustomCursor(ui, edit, moveCursor(edit.cursor, edit.view, name)); return }
    if (name === "up" || name === "down") {
      const next = rowStep(edit.cursor, edit.view, name)
      if (next) { moveCustomCursor(ui, edit, next); return }
      const side = leftHalf(edit.cursor, edit.view, data?.state.weekStart ?? "monday")
      go(name === "up" ? (side ? "page" : "views") : (side ? "from" : "to"))
      return
    }
    if (name === "[" || seq === "[" || name === "]" || seq === "]") { pageCustomCalendar(ui, name === "[" || seq === "[" ? -1 : 1); return }
    const view = ({ d: "days", m: "months", y: "years" } as const)[name as "d" | "m" | "y"]
    if (view && !key.ctrl && !key.meta) { setCustomView(ui, view); return }
    if (name === "t" && !key.ctrl) { moveCustomCursor(ui, edit, today); return }
    if (name === "return" || name === "enter" || name === "space") { markCustomCell(ui, edit.cursor); return }
    return
  }
  const side = edit.focus === "from" ? "start" : "end"
  if (name === "up") { go("grid"); return }
  if (name === "down") return
  if (name === "return" || name === "enter") {
    const read = readCustomRange(edit.start.value, edit.end.value, today)
    if ("error" in read) { ui.setState({ customEdit: { ...edit, focus: read.field, error: read.error } }); return }
    applyCustomRange(ui, read.start, read.end)
    return
  }
  const next = editText(edit[side], key)
  if (!next) return
  const day = rangeDayFromText(next.value, today, side)
  ui.setState({ customEdit: { ...edit, [side]: next, error: "", ...(day ? { cursor: day } : {}) } })
}

function overviewArrowKeys(ui: UiStore, key: KeyEvent, data?: DataStore): boolean {
  const { name } = key
  if (name === "up" || name === "down" || name === "left" || name === "right") {
    if (data && ui.state.focusedSection === "ov.categories" && (name === "up" || name === "down")) {
      const last = overviewCategoryLines(overviewRange(data, ui.state), openGroups(data.state.uiPrefs, ui.state)).length - 1
      const cursor = Math.min(ui.state.overviewCategoryCursor, last)
      if (name === "up" ? cursor > 0 : cursor < last) {
        moveOverviewCategory(ui, data, cursor + (name === "up" ? -1 : 1))
        return true
      }
    }
    travel(ui, name)
    return true
  }
  return false
}

function overviewChartKeys(ui: UiStore, key: KeyEvent, clock: Date, cycle: CycleConfig | undefined, data?: DataStore): boolean {
  const { name, sequence: seq } = key
  const scope = ui.activeScope()
  const back = (name === "h" || seq === ",") && !key.shift && scope === "overview"
  const forward = (name === "l" || seq === ".") && !key.shift && scope === "overview"
  const focused = chartPaneOf(ui.state.focusedSection)
  if ((back || forward) && focused >= 0 && focused < ui.state.overviewCharts) {
    const pane = focused
    const n = CHART_VIEWS.length
    const views: ChartViews = [...ui.state.chartViews]
    views[pane] = (views[pane] + (back ? -1 : 1) + n) % n
    ui.setState({ chartViews: views })
    return true
  }
  if (name === "d" && !key.ctrl && !key.meta) {
    const index = stepChip(ui.state.timeframe, key.shift || seq === "D" ? -1 : 1)
    const tf = applyChip(ui.state.timeframe, index, clock, cycle)
    ui.setTimeframe(tf)
    ui.setDashChipCursor(index)
    ui.setStatus(`${chipLabel(index)} · ${timeframeBounds(tf, clock, cycle).label}`)
    return true
  }
  if (name === "i" && !key.shift && scope === "overview" && data) {
    toTransactions(ui)
    if (!data.state.uncategorisedOnly) toggleUncategorised(ui, data)
    return true
  }
  if (isSmartSearchKey(key) && scope === "overview") {
    toTransactions(ui)
    openSmartSearch(ui, data)
    return true
  }
  if ((name === "/" || seq === "/") && scope === "overview") {
    toTransactions(ui)
    ui.openFilter(data?.state.filterQuery ?? "")
    return true
  }
  if (name === "a" && data) {
    const spending = data.state.accounts.filter((a) => accountRole(a) === "spending")
    const choices: AccountSelection[] = ["all", ...(spending.length > 1 ? spending.map((a) => a.id) : [])]
    const at = choices.indexOf(data.state.accountSelection)
    const next = choices[(at + 1) % choices.length]!
    changeAccountScope(ui, data, next, "overview")
    ui.setStatus(`Overview · ${spendingScope(data.state.accounts, next).label}`)
    return true
  }
  if (name === "[" || seq === "[" || name === "]" || seq === "]") {
    stepOverviewRange(ui, name === "[" || seq === "[" ? -1 : 1, data)
    return true
  }
  return false
}

function overviewRangeKeys(ui: UiStore, key: KeyEvent, clock: Date, cycle: CycleConfig | undefined, data?: DataStore): boolean {
  const { name, sequence: seq } = key
  const focus = ui.state.focusedSection
  if (data && focus === "ov.categories") {
    const lines = overviewCategoryLines(overviewRange(data, ui.state), openGroups(data.state.uiPrefs, ui.state))
    const moveTo = (i: number) => moveOverviewCategory(ui, data, i)
    const moved = listMove(key, ui.state.overviewCategoryCursor, lines.length)
    if (moved != null) { moveTo(moved); return true }
    const open = openGroups(data.state.uiPrefs, ui.state)
    if (open && (name === "space" || seq === " ")) {
      const at = Math.min(ui.state.overviewCategoryCursor, lines.length - 1)
      let g = at
      while (g > 0 && lines[g]!.child) g--
      const id = lines[g]?.categoryId
      if (id == null) return true
      ui.setState({ overviewOpen: open.includes(id) ? open.filter((x) => x !== id) : [...open, id], overviewCategoryCursor: g })
      return true
    }
    const line = lines[Math.min(ui.state.overviewCategoryCursor, lines.length - 1)]
    if (name === "o" && !key.shift && !key.ctrl && !key.meta && line) { drillDown(ui, data, line); return true }
  }
  if (data && name === "o" && !key.shift && !key.ctrl && !key.meta) { drillDown(ui, data); return true }
  if (name === "0") {
    const tf = timeframeNow(ui.state.timeframe, appNow(), cycle)
    ui.setTimeframe(tf)
    ui.setStatus(`Now · ${timeframeBounds(tf, clock, cycle).label}`)
    return true
  }
  if (name === "t" && !key.shift && !key.ctrl && !key.meta && data && ui.state.focusedSection === "ov.categories") {
    settleData(ui, data.saveUiPrefs({ rangeText: !data.state.uiPrefs.rangeText }), () => ui.setStatus(data.state.uiPrefs.rangeText ? "Range as text" : "Range as bars"))
    return true
  }
  if (name === "s" && !key.shift && !key.ctrl && !key.meta && data && !data.state.uiPrefs.rangeText && ui.state.focusedSection === "ov.categories") {
    const spending = data.state.uiPrefs.rangeView !== "spending"
    settleData(ui, data.saveUiPrefs({ rangeView: spending ? "spending" : "net" }), () => ui.setStatus(spending ? "Range: where the spending went" : "Range: where the net went"))
    return true
  }
  if (name === "z" && data) {
    settleData(ui, data.saveUiPrefs({ zeroAxis: !data.state.uiPrefs.zeroAxis }), () => ui.setStatus(data.state.uiPrefs.zeroAxis ? "Balance charts from $0" : "Balance charts fit their balances"))
    return true
  }
  if (shifted(key, "c") && !key.ctrl && !key.meta) { openCustomRange(ui, cycle); return true }
  if (name === "b" && !key.shift && !key.ctrl && !key.meta) {
    const tf = applyChip({ ...ui.state.timeframe, family: "period", period: "cycle" }, LOOKBACKS.length, appNow(), cycle)
    ui.setTimeframe(tf)
    ui.setDashChipCursor(activeChipIndex(tf))
    ui.setStatus(`This budget cycle · ${timeframeBounds(tf, clock, cycle).label}`)
    return true
  }
  return false
}

function handleOverview(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  const clock = appNow()
  const cycle = data?.cycle()
  if (overviewArrowKeys(ui, key, data)) return
  if (overviewChartKeys(ui, key, clock, cycle, data)) return
  if (overviewRangeKeys(ui, key, clock, cycle, data)) return
  if (name === "escape" && ui.state.focusedSection !== "none") ui.clearFocus()
}

export function stepOverviewRange(ui: UiStore, delta: -1 | 1, data?: DataStore): void {
  const clock = appNow()
  const cycle = data?.cycle()
  const was = ui.state.timeframe
  const tf = stepRange(was, delta, cycle)
  ui.setTimeframe(tf)
  ui.setDashChipCursor(activeChipIndex(tf))
  const kind = tf.family === "period" ? PERIOD_LABEL[tf.period] : tf.family === "lookback" ? tf.lookback : "Custom"
  const offset = rangeOffsetLabel(tf, clock, cycle)
  ui.setStatus(`${kind} · ${timeframeBounds(tf, clock, cycle).label}${offset ? ` · ${offset} · 0 for now` : ""}`)
}

function openCustomRange(ui: UiStore, cycle: CycleConfig | undefined): void {
  const from = ui.state.timeframe.custom ?? timeframeBounds(ui.state.timeframe, appNow(), cycle)
  ui.setState({ customEdit: {
    start: textField(rangeDayText(from.start)), end: textField(rangeDayText(from.end)), focus: "grid", error: "",
    view: "days", cursor: from.start, mark: null, before: null,
  } })
}

export function handleOverviewRange(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  const clock = appNow()
  const cycle = data?.cycle()
  if (name === "up" || name === "down" || (name === "left" && ui.state.dashChipCursor === 0) || (name === "right" && ui.state.dashChipCursor === chipCount() - 1)) {
    travel(ui, name)
    return
  }
  if (name === "h" || name === "left") {
    const n = chipCount()
    ui.setDashChipCursor((ui.state.dashChipCursor - 1 + n) % n)
    return
  }
  if (name === "l" || name === "right") {
    const n = chipCount()
    ui.setDashChipCursor((ui.state.dashChipCursor + 1) % n)
    return
  }
  if ((name === "return" || name === "enter") && ui.state.dashChipCursor === CUSTOM_CHIP) {
    openCustomRange(ui, cycle)
    return
  }
  if (name === "return" || name === "enter") {
    const tf = applyChip(ui.state.timeframe, ui.state.dashChipCursor, clock, cycle)
    ui.setTimeframe(tf)
    const label = tf.family === "lookback" ? tf.lookback : PERIOD_LABEL[tf.period]
    ui.setStatus(`${tf.family === "lookback" ? "Timeframe" : "Period"}: ${label} · ${timeframeBounds(tf, clock, cycle).label}`)
    return
  }
  handleOverview(ui, key, data)
}

export function drillDown(ui: UiStore, data: DataStore, line?: CategoryLine) {
  const range = overviewRange(data, ui.state)
  const query = drillFilter({
    start: range.bounds.start,
    end: range.bounds.end,
    accounts: range.scope.accounts.map((a) => a.name),
    category: line ? { id: line.categoryId, name: line.label } : undefined,
    categories: data.state.categories,
  })
  const back = { filter: data.state.filterQuery, focus: ui.state.focusedSection }
  toTransactions(ui)
  const result = data.commitFilter(query)
  if (!result.ok) { ui.setStatus(result.err, true); return }
  ui.setState({ drillReturn: back })
  const n = data.scopedTransactions().length
  ui.jumpManagerCursor(0, n)
  ui.setStatus(`${line?.label ?? "Spending"} · ${range.bounds.label} · ${count(n, "transaction")} · esc back`)
}

const rangePaneKeys = (state?: HintState): Hint[] => [
  { key: "t", desc: state?.rangeText ? "bars" : "text", label: "Range pane: bars or text" },
  ...(state?.rangeText ? [] : [{ key: "s", desc: state?.rangeView === "spending" ? "net view" : "spending view", label: "Range: where the spending or the net went" }]),
]

function overviewTabKeys(state: HintState | undefined, own: { chart: number }): Hint[] {
  const range = state?.focusedSection === "ov.categories"
  const balances = (i: number | undefined) => i != null && CHART_VIEWS[i]?.group === "Balances"
  const focus = state?.focusedSection
  return tabWide([
    ...(range ? [] : [{ key: "o", desc: "transactions", label: "The range's transactions" }]),
    { key: "d/D", desc: "range" },
    { key: "[ ]", desc: "period" },
    ...(state?.customRange ? [{ key: "C", desc: "edit dates", label: "Range: custom dates" }] : []),
    { key: "b", desc: "budget", label: "Range: this budget cycle" },
    ...((state?.spendingAccounts ?? 0) > 1 ? [{ key: "a", desc: "account", label: "Next spending account" }] : []),
    { key: "i", desc: "review", command: "txn:uncategorised", paletteOnly: true },
    { key: "/", desc: "search", command: "txn:filter", paletteOnly: true },
    { key: "?", desc: "smart search", command: "txn:smart-search", paletteOnly: true },
    ...(state?.customRange ? [] : [{ key: "C", desc: "custom range", label: "Range: custom dates", paletteOnly: true }]),
    { key: "0", desc: "now", label: "Range: back to now", description: "the same kind of range" },
    ...(own.chart < 0 && state?.chartViews.slice(0, state.overviewCharts ?? 2).some(balances) ? [{ key: "z", desc: "$0 axis", paletteOnly: true }] : []),
    ...(focus && focus !== "none" ? [{ key: "esc", desc: "done" }] : []),
    { key: "v", desc: "jump" },
    { key: "1-4", desc: "tab" },
  ])
}

export const overviewScopes = {
  "overview.custom": {
    handle: handleOverviewCustom,
    list: false,
    hints: () => [
      { key: "tab", desc: "field" },
      { key: "enter", desc: "apply" },
      { key: "esc", desc: "cancel" },
    ],
  },
  "overview": {
    handle: handleOverview,
    list: true,
    pane: (state) => {
      const focus = state?.focusedSection
      const chart = focus ? chartPaneOf(focus) : -1
      if (chart >= 0) return CHART_VIEWS[state!.chartViews[chart] ?? 0]?.title ?? "Chart"
      return focus === "ov.categories" ? "Range" : focus === "ov.accounts" ? "Accounts" : null
    },
    hints: (state) => {
      const focus = state?.focusedSection
      const chart = state && focus ? chartPaneOf(focus) : -1
      const balances = (i: number | undefined) => i != null && CHART_VIEWS[i]?.group === "Balances"
      const range = focus === "ov.categories"
      const rangeKeys = rangePaneKeys(state)
      const pane: Hint[] = range ? [{ key: "j/k", desc: "move" }, ...(state?.rangeText ? [] : [{ key: "space", desc: "open group" }]), { key: "o", desc: "its transactions", label: "The category's transactions" }, ...rangeKeys]
        : chart >= 0 ? [{ key: "h/l", desc: "view" }, ...(balances(state!.chartViews[chart]) ? [{ key: "z", desc: "$0 axis", paletteOnly: true }] : [])]
        : []
      return [...pane, ...overviewTabKeys(state, { chart })]
    },
  },
  "overview.range": {
    handle: handleOverviewRange,
    list: true,
    pane: () => "Date Range",
    hints: (state) => [{ key: "h/l", desc: "chip" }, { key: "enter", desc: "apply" }, ...overviewTabKeys(state, { chart: -1 })],
  },
} satisfies Partial<Record<ScopeId, ScopeEntry>>

