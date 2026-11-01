import { DEFAULT_CHART_MOTION, nextChartSpeed } from "../ui/charts/motion"
import { runAsk } from "./ask"
import { llmModelId } from "../ai/llm"
import type { AccountSelection, AccountRow } from "../domain/accountTree"
import type { SavedFilter } from "../domain/types"
import type { DataStore } from "../state/dataStore"
import type { UiStore } from "../state/uiStore"

/**
 * Actions a key and a palette command (app/commands) both run: one body
 * each, so a key and its command can't drift apart.
 */
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

/** No filter on the table (or the merchants), cursors back to the top. */
export function clearTransactionFilter(ui: UiStore, data: DataStore): void {
  data.clearFilter()
  resetTransactionCursors(ui, data)
  ui.setStatus("Filter cleared")
}

/** The Transactions table, focused (from any tab). */
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

/** Demo mode on (made-up rows, the real database untouched) or off;
 * resolves once it's done (or failed, which the status line says). */
export function toggleDemo(ui: UiStore, data: DataStore): Promise<void> {
  const done = (async () => {
    if (data.state.demo) { await data.leaveDemo(); ui.setStatus("Demo mode off · your data") }
    else ui.setStatus(`Demo mode: ${(await data.enterDemo()).toLocaleString("en-AU")} made-up transactions over 3 years · your data is untouched · sync is off`)
    resetTransactionCursors(ui, data)
    ui.setState({ selectedIds: {}, range: null, detail: null })
  })()
  settleData(ui, done)
  return done.catch(() => {})
}

export function toggleXAxis(ui: UiStore, data: DataStore): void {
  settleData(ui, data.saveUiPrefs({ xAxis: !data.state.uiPrefs.xAxis }), () => ui.setStatus(data.state.uiPrefs.xAxis ? "Charts draw an x-axis line" : "Charts without an x-axis line"))
}

/** A saved filter on the table, its use recorded; false when it doesn't parse. */
export function applySavedFilter(ui: UiStore, data: DataStore, filter: SavedFilter): boolean {
  const result = data.commitFilter(filter.expr)
  if (!result.ok) { ui.setStatus(result.err, true); return false }
  resetTransactionCursors(ui, data)
  settleData(ui, data.recordFilterUsage(filter.id), () => ui.setStatus(`Filter: ${filter.name}`))
  void runAsk(ui, data)
  return true
}

/** Account reset matrix: accounts clears row position and targets; rows and
 * merchants also clear merchant position; Overview preserves both.
 * Approved deviation from Go: changing the table's account clears hidden targets. */
export function changeAccountScope(ui: UiStore, data: DataStore, selection: AccountSelection, origin: "accounts" | "rows" | "merchants" | "overview"): void {
  if (origin !== "overview") ui.setState({ managerCursor: 0, managerTop: 0, selectedIds: {}, range: null })
  data.setAccountSelection(selection)
  if (origin === "rows" || origin === "merchants") resetTransactionCursors(ui, data)
}

/** The table shows an account (a row of the accounts pane). */
export function showAccount(ui: UiStore, data: DataStore, row: AccountRow): void {
  changeAccountScope(ui, data, row.selection, ui.state.txnView)
  ui.setStatus(`Showing ${row.label}`)
}

export function runUndo(ui: UiStore, data: DataStore): void {
  void data.undo().then((summary) => ui.setStatus(summary, summary.includes("failed:") || summary.includes("waiting for Up")), (error) => reportError(ui, error))
}

/** The general model writes rules from the history (the offers list's last row). */
export function askForRules(ui: UiStore, data: DataStore): void {
  if (data.state.writingRules) return
  ui.setStatus(`Asking ${llmModelId()} for rules…`)
  data.askForRules().then((summary) => ui.setStatus(summary), (error) => reportError(ui, error))
}

export function toggleChartMotion(ui: UiStore, data: DataStore): void {
  const chartMotion = (data.state.uiPrefs.chartMotion ?? DEFAULT_CHART_MOTION) === "launch" ? "always" : "launch"
  settleData(ui, data.saveUiPrefs({ chartMotion }), () => ui.setStatus(chartMotion === "always" ? "Charts draw in every time" : "Charts draw in once, at launch"))
}

export function cycleChartSpeed(ui: UiStore, data: DataStore): void {
  const speed = nextChartSpeed(data.state.uiPrefs.chartSpeed)
  settleData(ui, data.saveUiPrefs({ chartSpeed: speed.id }), () => ui.setStatus(`Animation speed: ${speed.label}`))
}
