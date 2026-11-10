import { nextOpenRange, OPEN_RANGE_LABELS } from "../domain/timeframe"
import { DEFAULT_THEME, THEMES } from "../themes"
import { themeName } from "../state/appearanceRows"
import { BACKDROPS, DEFAULT_BACKDROP } from "../ui/welcome/backdrop"
import { CHART_LABEL_LABELS, DEFAULT_CHART_LABELS, chartCurveName, nextChartCurve, nextChartMotion, nextChartSpeed } from "../ui/charts/motion"
import { runAsk } from "./ask"
import { DEMO_YEARS } from "../domain/demo"
import { llmModelId } from "../ai/llm"
import type { AccountSelection, AccountRow } from "../domain/accountTree"
import type { SavedFilter } from "../domain/types"
import type { DataStore } from "../state/dataStore"
import type { UiStore } from "../state/uiStore"

export function reportError(ui: UiStore, error: unknown): void {
  ui.setStatus(error instanceof Error ? error.message : String(error), true)
}

export function settleData<T>(ui: UiStore, p: Promise<T>, ok?: (value: T) => void): void {
  void p.then(ok).catch((error) => reportError(ui, error))
}

export function resetTransactionCursors(ui: UiStore, data?: DataStore): void {
  ui.jumpManagerCursor(0, data?.scopedTransactions().length ?? 0)
  ui.setState({ merchantCursor: 0, merchantTop: 0 })
}

export function clearTransactionFilter(ui: UiStore, data: DataStore): void {
  data.clearFilter()
  resetTransactionCursors(ui, data)
  ui.setStatus("Filter cleared")
}

export function toTransactions(ui: UiStore): void {
  if (ui.state.activeTab !== "manager") ui.switchTab("manager")
  ui.setState({ txnView: "rows", focusedSection: "mgr.transactions" })
}

export function applyAllRules(ui: UiStore, data: DataStore): void {
  settleData(ui, data.applyRules(), (result) => ui.setStatus(`Rules applied · ${result.updatedTransactions} transactions`))
}

export function showDryRun(ui: UiStore, data: DataStore): void {
  ui.setState({ dryRun: { scroll: 0, visible: 10, report: data.dryRunRules() } })
}

export function toggleIcons(ui: UiStore, data: DataStore): void {
  settleData(ui, data.setIcons(!data.state.icons), () => ui.setStatus(data.state.icons ? "Category icons on (needs a Nerd Font)" : "Category icons off"))
}

export function toggleWeekStart(ui: UiStore, data: DataStore): void {
  settleData(ui, data.saveUiPrefs({ weekStart: data.state.weekStart === "monday" ? "sunday" : "monday" }), () => ui.setStatus(data.state.weekStart === "sunday" ? "Weeks start on Sunday" : "Weeks start on Monday"))
}

export function toggleDemo(ui: UiStore, data: DataStore): Promise<void> {
  const done = (async () => {
    if (data.state.demo) { await data.leaveDemo(); ui.setStatus("Demo mode off · your data") }
    else ui.setStatus(`Demo mode: ${(await data.enterDemo()).toLocaleString("en-AU")} made-up transactions over ${DEMO_YEARS} years · your data is untouched · sync is off`)
    resetTransactionCursors(ui, data)
    ui.setState({ selectedIds: {}, range: null, detail: null })
  })()
  settleData(ui, done)
  return done.catch(() => {})
}

export function openThemePicker(ui: UiStore, data: DataStore): void {
  ui.setState({ themePicker: { cursor: Math.max(0, THEMES.findIndex((t) => t.id === (data.state.uiPrefs.theme ?? DEFAULT_THEME))) } })
}

export function keepTheme(ui: UiStore, data: DataStore, id: string): void {
  settleData(ui, data.saveUiPrefs({ theme: id }), () => {
    ui.setState({ themePicker: null })
    ui.setStatus(`Theme: ${themeName(id)}`)
  })
}

export function toggleXAxis(ui: UiStore, data: DataStore): void {
  settleData(ui, data.saveUiPrefs({ xAxis: !data.state.uiPrefs.xAxis }), () => ui.setStatus(data.state.uiPrefs.xAxis ? "Charts draw an x-axis line" : "Charts without an x-axis line"))
}

export function applySavedFilter(ui: UiStore, data: DataStore, filter: SavedFilter): boolean {
  const result = data.commitFilter(filter.expr)
  if (!result.ok) { ui.setStatus(result.err, true); return false }
  resetTransactionCursors(ui, data)
  settleData(ui, data.recordFilterUsage(filter.id), () => ui.setStatus(`Filter: ${filter.name}`))
  void runAsk(ui, data)
  return true
}

export function changeAccountScope(ui: UiStore, data: DataStore, selection: AccountSelection, origin: "accounts" | "rows" | "merchants" | "overview"): void {
  if (origin !== "overview") ui.setState({ managerCursor: 0, managerTop: 0, selectedIds: {}, range: null })
  data.setAccountSelection(selection)
  if (origin === "rows" || origin === "merchants") resetTransactionCursors(ui, data)
}

export function showAccount(ui: UiStore, data: DataStore, row: AccountRow): void {
  changeAccountScope(ui, data, row.selection, ui.state.txnView)
  ui.setStatus(`Showing ${row.label}`)
}

export function runUndo(ui: UiStore, data: DataStore): void {
  void data.undo().then((summary) => ui.setStatus(summary, summary.includes("failed:") || summary.includes("waiting for Up")), (error) => reportError(ui, error))
}

export function askForRules(ui: UiStore, data: DataStore): void {
  if (data.state.writingRules) return
  ui.setStatus(`Asking ${llmModelId()} for rules…`)
  data.askForRules().then((summary) => ui.setStatus(summary), (error) => reportError(ui, error))
}

export function toggleChartMotion(ui: UiStore, data: DataStore): void {
  const chartMotion = nextChartMotion(data.state.uiPrefs.chartMotion)
  settleData(ui, data.saveUiPrefs({ chartMotion }), () => ui.setStatus(chartMotion === "always" ? "Charts draw in every time" : chartMotion === "off" ? "Charts don't draw in" : "Charts draw in once, at launch"))
}

export function cycleChartSpeed(ui: UiStore, data: DataStore): void {
  const speed = nextChartSpeed(data.state.uiPrefs.chartSpeed)
  settleData(ui, data.saveUiPrefs({ chartSpeed: speed.id }), () => ui.setStatus(`Animation speed: ${speed.label}`))
}

export function cycleChartCurve(ui: UiStore, data: DataStore): void {
  const curve = nextChartCurve(data.state.uiPrefs.chartCurve)
  settleData(ui, data.saveUiPrefs({ chartCurve: curve.id }), () => ui.setStatus(`Animation curve: ${chartCurveName(curve)}`))
}

export function toggleChartLabels(ui: UiStore, data: DataStore): void {
  const chartLabels = (data.state.uiPrefs.chartLabels ?? DEFAULT_CHART_LABELS) === "together" ? "sequential" : "together"
  settleData(ui, data.saveUiPrefs({ chartLabels }), () => ui.setStatus(`Chart labels appear ${CHART_LABEL_LABELS[chartLabels]}`))
}

export function cycleOpenRange(ui: UiStore, data: DataStore): void {
  const openRange = nextOpenRange(data.state.uiPrefs.openRange)
  settleData(ui, data.saveUiPrefs({ openRange }), () => ui.setStatus(`Range on open: ${OPEN_RANGE_LABELS[openRange]}`))
}

export function cycleBackdrop(ui: UiStore, data: DataStore): void {
  const at = BACKDROPS.findIndex((entry) => entry.id === (data.state.uiPrefs.backdrop ?? DEFAULT_BACKDROP))
  const backdrop = BACKDROPS[(at + 1) % BACKDROPS.length]!
  settleData(ui, data.saveUiPrefs({ backdrop: backdrop.id }), () => ui.setStatus(`Welcome backdrop: ${backdrop.label}`))
}
