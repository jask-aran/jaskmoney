import { nextOpenRange, OPEN_RANGE_LABELS } from "../domain/timeframe"
import { BACKDROPS, DEFAULT_BACKDROP } from "../ui/welcome/backdrop"
import { openWelcome } from "./welcome"
import type { KeyEvent } from "@opentui/core"
import { accountRows } from "../domain/accountTree"
import { fuzzyScore } from "../domain/fuzzy"
import type { DataStore } from "../state/dataStore"
import { DATABASE_ROWS } from "../state/databaseRows"
import { CHART_LABEL_LABELS, DEFAULT_CHART_LABELS, CHART_MOTION_LABELS, chartCurveName, nextChartCurve, nextChartMotion, nextChartSpeed } from "../ui/charts/motion"
import { SETTINGS_SECTION_LABELS, SETTINGS_SECTIONS, TABS, type ScopeId, type UiState, type UiStore } from "../state/uiStore"
import { applyAllRules, applySavedFilter, clearTransactionFilter, askForRules, runUndo, showAccount, showDryRun, toggleIcons, toggleWeekStart, toggleXAxis, openThemePicker, toggleChartMotion, cycleChartSpeed, cycleChartCurve, toggleChartLabels, cycleOpenRange, cycleBackdrop, toTransactions } from "./actions"
import { AI_ROWS, aiRowLabel, isLlmRow } from "./apiKeys"
import { keyEvent } from "./keyEvent"
import { hintEvent, scopeLabel, type Hint } from "./palette"
import { toggleUncategorised } from "./suggest"
import { runSync } from "./sync"

interface CommandContext {
  ui: UiStore
  data: DataStore
  from: ScopeId
  press: (key: KeyEvent, expected: ScopeId) => void
}

export interface Command {
  id: string
  label: string
  description?: string
  key?: string
  category: string
  disabled?: string
  run: () => void
}

export const CATEGORIES = ["Transactions", "Rules", "Data", "Add", "AI models", "Display", "Settings", "Go to"] as const

type Entry = Omit<Command, "category"> & { category: (typeof CATEGORIES)[number] }
type Section = UiState["settingsSection"]

interface Parts {
  ctx: CommandContext
  ui: UiStore
  data: DataStore
  toSettings: (section: Section, list?: "categories" | "tags") => void
  inSettings: (section: Section, hint: string, setup?: () => void, list?: "categories" | "tags") => () => void
  inTransactions: (hint: string) => () => void
  inBudgets: (hint: string) => () => void
  filter: string
  undo: ReturnType<DataStore["undoLabel"]>
  offers: number
}

function transactionCommands({ ui, data, inTransactions, filter, undo }: Parts): Entry[] {
  return [
    { id: "txn:uncategorised", category: "Transactions", label: "Review uncategorised", description: "rows waiting for a category",
      disabled: data.state.uncategorisedOnly ? "showing them now" : undefined,
      run: () => { toTransactions(ui); if (data.state.tagReview) data.closeTagReview(); toggleUncategorised(ui, data) } },
    { id: "txn:tag-review", category: "Transactions", label: "Find transactions for a tag…", description: "yours, a trip, or a new one", run: inTransactions("T") },
    { id: "txn:filter", category: "Transactions", label: "Filter…", description: "desc:coffee amt:>20", run: () => { toTransactions(ui); ui.openFilter(filter) } },
    { id: "txn:smart-search", category: "Transactions", label: "Smart search…", description: "a question in words", run: inTransactions("?") },
    { id: "txn:clear-filter", category: "Transactions", label: "Clear the filter", description: filter || undefined, disabled: filter ? undefined : "no filter",
      run: () => clearTransactionFilter(ui, data) },
    { id: "txn:save-filter", category: "Transactions", label: "Save the filter…", disabled: filter ? undefined : "no filter", run: inTransactions("ctrl+s") },
    { id: "txn:undo", category: "Transactions", label: undo ? `Undo ${undo}` : "Undo", disabled: undo ? undefined : "nothing to undo", run: () => runUndo(ui, data) },
    ...data.state.savedFilters.map((saved): Entry => ({
      id: `txn:saved:${saved.id}`, category: "Transactions", label: `Filter: ${saved.name}`, description: saved.expr,
      disabled: filter === saved.expr ? "applied now" : undefined,
      run: () => { toTransactions(ui); applySavedFilter(ui, data, saved) },
    })),
    ...accountRows(data.state.accounts).map((row): Entry => ({
      id: `txn:account:${row.selection}`, category: "Transactions", label: `Show ${row.label}`,
      disabled: data.state.accountSelection === row.selection ? "showing it now" : undefined,
      run: () => { toTransactions(ui); showAccount(ui, data, row) },
    })),
  ]
}

function ruleAndDataCommands({ ui, data, inSettings, inTransactions, offers }: Parts): Entry[] {
  return [
    { id: "rules:offers", category: "Rules", label: offers ? `Rules offered (${offers})…` : "Rules offered…", description: "from repeated categorising",
      disabled: offers || data.state.llm ? undefined : "none yet", run: inTransactions("R") },
    { id: "rules:ask-ai", category: "Rules", label: "Ask the AI for rules", description: data.state.llm ?? undefined,
      disabled: !data.state.llm ? "no model set up" : data.state.writingRules ? "asking now" : undefined,
      run: () => { toTransactions(ui); ui.setState({ ruleOffers: { cursor: data.allRuleOffers().length, busy: false } }); askForRules(ui, data) } },
    { id: "rules:apply", category: "Rules", label: "Apply all rules", description: "to every transaction", run: () => applyAllRules(ui, data) },
    { id: "rules:dry-run", category: "Rules", label: "Dry-run the rules", description: "what they'd change", run: () => showDryRun(ui, data) },
    { id: "data:sync", category: "Data", label: "Sync with Up", key: "ctrl+r",
      disabled: !data.state.apiKeys.JASKMONEY_UP_TOKEN.source ? "no Up token" : data.state.upSyncing ? "syncing now" : undefined,
      run: () => { void runSync(ui, data, { manual: true }) } },
    { id: "data:import", category: "Data", label: "Import a CSV…", run: inSettings("database", "enter", () => ui.setState({ databaseCursor: DATABASE_ROWS.indexOf("import") })) },
    { id: "data:clear", category: "Data", label: "Clear transaction data…", description: "asks again", run: inSettings("database", "enter", () => ui.setState({ databaseCursor: DATABASE_ROWS.indexOf("clearData") })) },
    { id: "data:reset", category: "Data", label: "Reset the database…", description: "type RESET", run: inSettings("database", "enter", () => ui.setState({ databaseCursor: DATABASE_ROWS.indexOf("reset") })) },
  ]
}

function addCommands({ ui, inSettings, inBudgets }: Parts): Entry[] {
  return [
    { id: "add:category", category: "Add", label: "Category…", run: inSettings("taxonomy", "a", undefined, "categories") },
    { id: "add:tag", category: "Add", label: "Tag…", run: inSettings("taxonomy", "a", undefined, "tags") },
    { id: "add:rule", category: "Add", label: "Rule…", run: inSettings("rules", "a") },
    { id: "add:filter", category: "Add", label: "Saved filter…", run: inSettings("filters", "a") },
    { id: "add:budget", category: "Add", label: "Budget…", run: inBudgets("a") },
    ...AI_ROWS.map((row, i): Entry => ({
      id: `ai:${row}`, category: "AI models", label: `${aiRowLabel(row)}…`, description: isLlmRow(row) ? "sign in or key" : "key",
      run: inSettings("ai", "enter", () => ui.setState({ aiCursor: i })),
    })),
  ]
}

function displayCommands({ ui, data }: Parts): Entry[] {
  return [
    { id: "display:theme", category: "Display", label: "Theme…", description: "preview and pick a colour theme", run: () => openThemePicker(ui, data) },
    { id: "display:icons", category: "Display", label: `Category icons ${data.state.icons ? "off" : "on"}`, run: () => toggleIcons(ui, data) },
    { id: "display:week", category: "Display", label: `Weeks start ${data.state.weekStart === "monday" ? "Sunday" : "Monday"}`, run: () => toggleWeekStart(ui, data) },
    { id: "display:x-axis", category: "Display", label: `Charts' $0 line ${data.state.uiPrefs.xAxis ? "off" : "on"}`, run: () => toggleXAxis(ui, data) },
    { id: "display:chart-motion", category: "Display", label: `Chart animation: ${CHART_MOTION_LABELS[nextChartMotion(data.state.uiPrefs.chartMotion)]}`, run: () => toggleChartMotion(ui, data) },
    { id: "display:chart-speed", category: "Display", label: `Animation speed: ${nextChartSpeed(data.state.uiPrefs.chartSpeed).label}`, run: () => cycleChartSpeed(ui, data) },
    { id: "display:chart-curve", category: "Display", label: `Animation curve: ${chartCurveName(nextChartCurve(data.state.uiPrefs.chartCurve))}`, run: () => cycleChartCurve(ui, data) },
    { id: "display:chart-labels", category: "Display", label: `Chart labels: ${CHART_LABEL_LABELS[(data.state.uiPrefs.chartLabels ?? DEFAULT_CHART_LABELS) === "together" ? "sequential" : "together"]}`, run: () => toggleChartLabels(ui, data) },
    { id: "display:open-range", category: "Display", label: `Range on open: ${OPEN_RANGE_LABELS[nextOpenRange(data.state.uiPrefs.openRange)]}`, run: () => cycleOpenRange(ui, data) },
    { id: "display:backdrop", category: "Display", label: `Welcome backdrop: ${BACKDROPS[(BACKDROPS.findIndex((entry) => entry.id === (data.state.uiPrefs.backdrop ?? DEFAULT_BACKDROP)) + 1) % BACKDROPS.length]!.label}`, run: () => cycleBackdrop(ui, data) },
  ]
}

function settingsCommands({ ctx, ui, toSettings, inBudgets }: Parts): Entry[] {
  return [
    { id: "settings:cycle", category: "Settings", label: "Budget cycle…", description: "e.g. from payday", run: inBudgets("c") },
    { id: "settings:setup", category: "Settings", label: "First-time setup…", description: "Up, the AI, your email", run: () => openWelcome(ui) },
    ...SETTINGS_SECTIONS.map((section): Entry => ({ id: `settings:${section}`, category: "Settings", label: SETTINGS_SECTION_LABELS[section], run: () => toSettings(section) })),
    ...TABS.map((tab): Entry => ({
      id: `go:${tab.id}`, category: "Go to", label: tab.label, key: tab.hotkey,
      disabled: ui.state.activeTab === tab.id ? "here now" : undefined, run: () => ui.switchTab(tab.id),
    })),
    { id: "go:jump", category: "Go to", label: "Jump to a pane", key: "v", run: () => ctx.press(keyEvent("v"), ctx.from) },
  ]
}

function registry(ctx: CommandContext): Entry[] {
  const { ui, data } = ctx
  const toSettings = (section: Section, list: "categories" | "tags" = "categories") => {
    if (ui.state.activeTab !== "settings") ui.switchTab("settings")
    ui.activateSettings(section, list)
  }
  const inSettings = (section: Section, hint: string, setup?: () => void, list?: "categories" | "tags") => () => {
    toSettings(section, list)
    setup?.()
    ctx.press(hintEvent(hint)!, `settings.${section}`)
  }
  const inTransactions = (hint: string) => () => { toTransactions(ui); ctx.press(hintEvent(hint)!, "manager.txns") }
  const inBudgets = (hint: string) => () => {
    if (ui.state.activeTab !== "budgets") ui.switchTab("budgets")
    ui.setState({ focusedSection: "bud.categories" })
    ctx.press(hintEvent(hint)!, "budgets.categories")
  }
  const filter = data.state.filterQuery
  const undo = data.undoLabel()
  const offers = data.allRuleOffers().length
  const parts: Parts = { ctx, ui, data, toSettings, inSettings, inTransactions, inBudgets, filter, undo, offers }
  return [...transactionCommands(parts), ...ruleAndDataCommands(parts), ...addCommands(parts), ...displayCommands(parts), ...settingsCommands(parts)]
}

export function commands(ctx: CommandContext, hints: Hint[]): Command[] {
  const entries = registry(ctx)
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const here = scopeLabel(ctx.from)
  const used = new Set<string>()
  const own = hints.flatMap((hint): Command[] => {
    const event = hintEvent(hint.key)
    if (!event || hint.key === "esc" || used.has(`key:${hint.key}`)) return []
    used.add(`key:${hint.key}`)
    const linked = hint.command ? byId.get(hint.command) : undefined
    if (hint.command && !linked) throw new Error(`hint ${hint.key} names no command ${hint.command}`)
    if (linked) used.add(linked.id)
    const run = () => ctx.press(event, ctx.from)
    return [linked
      ? { ...linked, key: hint.key, category: here, run }
      : { id: `key:${ctx.from}:${hint.key}`, label: hint.label ?? hint.desc[0]!.toUpperCase() + hint.desc.slice(1), description: hint.description, key: hint.key, category: here, run }]
  })
  return [...own, ...entries.filter((entry) => !used.has(entry.id) && !(entry.key && used.has(`key:${entry.key}`)))]
}

function commandScore(command: Command, query: string): number | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const fuzzy = (text: string) => {
    let total = 0
    for (const word of words) { const score = fuzzyScore(word, text); if (score == null) return null; total += score }
    return total
  }
  const named = [command.label, command.id, command.key ?? ""].map(fuzzy).filter((s): s is number => s != null)
  if (named.length) return Math.max(...named) + 100
  const context = `${command.description ?? ""} ${command.category}`.toLowerCase()
  return words.every((word) => context.includes(word)) ? words.length : null
}

export function rankCommands(list: Command[], query: string, lastId: string | null): Command[] {
  const q = query.trim()
  if (!q) {
    const runnable = list.filter((command) => !command.disabled)
    const last = runnable.find((command) => command.id === lastId)
    return last ? [last, ...runnable.filter((command) => command !== last)] : runnable
  }
  return list.flatMap((command, order) => {
    const score = commandScore(command, q)
    return score == null ? [] : [{ command, order, score }]
  }).sort((a, b) => Number(!!a.command.disabled) - Number(!!b.command.disabled) || b.score - a.score || a.order - b.order)
    .map((entry) => entry.command)
}
