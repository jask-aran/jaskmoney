import { llmModelId } from "../ai/llm"
import type { AccountRow } from "../domain/accountTree"
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
  if (ui.state.focusedSection !== "mgr.transactions") ui.setState({ focusedSection: "mgr.transactions" })
}

export function applyAllRules(ui: UiStore, data: DataStore): void {
  ui.setStatus(`Rules applied · ${data.applyRules().updatedTransactions} transactions`)
}

export function showDryRun(ui: UiStore, data: DataStore): void {
  ui.setState({ dryRunReport: data.dryRunRules(), dryRunScroll: 0 })
}

export function toggleIcons(ui: UiStore, data: DataStore): void {
  data.setIcons(!data.state.icons)
  ui.setStatus(data.state.icons ? "Category icons on (needs a Nerd Font)" : "Category icons off")
}

export function toggleWeekStart(ui: UiStore, data: DataStore): void {
  data.saveUiPrefs({ weekStart: data.state.weekStart === "monday" ? "sunday" : "monday" })
  ui.setStatus(data.state.weekStart === "sunday" ? "Weeks start on Sunday" : "Weeks start on Monday")
}

export function toggleXAxis(ui: UiStore, data: DataStore): void {
  data.saveUiPrefs({ xAxis: !data.state.uiPrefs.xAxis })
  ui.setStatus(data.state.uiPrefs.xAxis ? "Charts draw an x-axis line" : "Charts without an x-axis line")
}

/** A saved filter on the table, its use recorded; false when it doesn't parse. */
export function applySavedFilter(ui: UiStore, data: DataStore, filter: SavedFilter): boolean {
  const result = data.commitFilter(filter.expr)
  if (!result.ok) { ui.setStatus(result.err, true); return false }
  resetTransactionCursors(ui, data)
  try { data.recordFilterUsage(filter.id); ui.setStatus(`Filter: ${filter.name}`) } catch (error) { reportError(ui, error) }
  return true
}

/** The table shows an account (a row of the accounts pane). */
export function showAccount(ui: UiStore, data: DataStore, row: AccountRow): void {
  data.setAccountSelection(row.selection)
  ui.jumpManagerCursor(0, data.scopedTransactions().length)
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
