import type { KeyEvent } from "@opentui/core"
import { hasLlm, llmModelId } from "../ai/llm"
import { accountRows } from "../domain/accountTree"
import { fuzzyScore } from "../domain/fuzzy"
import type { DataStore } from "../state/dataStore"
import { DATABASE_ROWS } from "../state/databaseRows"
import { SETTINGS_SECTION_LABELS, SETTINGS_SECTIONS, TABS, type ScopeId, type UiState, type UiStore } from "../state/uiStore"
import { applyAllRules, applySavedFilter, askForRules, runUndo, showAccount, showDryRun, toggleIcons, toggleWeekStart, toggleXAxis, toTransactions } from "./actions"
import { AI_ROWS, aiRowLabel, isLlmRow } from "./apiKeys"
import { keyEvent } from "./keyEvent"
import { hintEvent, scopeLabel, type Hint } from "./palette"
import { toggleUncategorised } from "./suggest"
import { runSync } from "./sync"

/**
 * The command palette's commands (ctrl+k), after the legacy registry
 * (legacy/go/commands.go). Keys live in one place, the panes' hints
 * (app/keys): a one-key hint is a command here, either the registry
 * command it names (`command`) or its own (label, description), and runs by
 * pressing its key where the palette opened. The registry holds what works
 * from anywhere: each command's label, description, category, why it can't
 * run now, and how it runs (going to the pane it needs; the bodies are
 * app/actions', shared with the keys). Only global keys (ctrl+r, the tabs,
 * v) are declared here.
 */
export interface CommandContext {
  ui: UiStore
  data: DataStore
  /** The scope the palette opened over. */
  from: ScopeId
  /** Presses a key where input now is (handleKey). */
  press: (key: KeyEvent) => void
}

export interface Command {
  id: string
  label: string
  description?: string
  /** Its key where the palette opened, if it has one there. */
  key?: string
  /** The palette's group: the pane's name for the pane's own, else CATEGORIES'. */
  category: string
  /** Why it can't run now; undefined when it can. */
  disabled?: string
  run: () => void
}

/** The registry's groups, in the palette's order (after the pane's own). */
export const CATEGORIES = ["Transactions", "Rules", "Data", "Add", "AI models", "Display", "Settings", "Go to"] as const

type Entry = Omit<Command, "category"> & { category: (typeof CATEGORIES)[number] }
type Section = UiState["settingsSection"]

function registry(ctx: CommandContext): Entry[] {
  const { ui, data } = ctx
  const status = (text: string) => ui.setStatus(text)
  const toSettings = (section: Section, list: "categories" | "tags" = "categories") => {
    if (ui.state.activeTab !== "settings") ui.switchTab("settings")
    ui.activateSettings(section, list)
  }
  // A Settings pane's own key, pressed there.
  const inSettings = (section: Section, hint: string, setup?: () => void, list?: "categories" | "tags") => () => {
    toSettings(section, list)
    setup?.()
    ctx.press(hintEvent(hint)!)
  }
  const inTransactions = (hint: string) => () => { toTransactions(ui); ctx.press(hintEvent(hint)!) }
  const filter = data.state.filterQuery
  const undo = data.undoLabel()
  const offers = data.allRuleOffers().length
  return [
    // Transactions
    { id: "txn:uncategorised", category: "Transactions", label: "Review uncategorised", description: "rows waiting for a category",
      disabled: data.state.uncategorisedOnly ? "showing them now" : undefined,
      run: () => { toTransactions(ui); if (data.state.tagReview) data.closeTagReview(); toggleUncategorised(ui, data) } },
    { id: "txn:tag-review", category: "Transactions", label: "Find transactions for a tag…", description: "yours, a trip, or a new one", run: inTransactions("T") },
    { id: "txn:filter", category: "Transactions", label: "Filter…", description: "desc:coffee amt:>20", run: () => { toTransactions(ui); ui.openFilter(filter) } },
    { id: "txn:smart-search", category: "Transactions", label: "Smart search…", description: "a question in words", run: inTransactions("?") },
    { id: "txn:clear-filter", category: "Transactions", label: "Clear the filter", description: filter || undefined, disabled: filter ? undefined : "no filter",
      run: () => { data.clearFilter(); ui.jumpManagerCursor(0, data.scopedTransactions().length); status("Filter cleared") } },
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
    // Rules
    { id: "rules:offers", category: "Rules", label: offers ? `Rules offered (${offers})…` : "Rules offered…", description: "from repeated categorising",
      disabled: offers || hasLlm() ? undefined : "none yet", run: inTransactions("R") },
    { id: "rules:ask-ai", category: "Rules", label: "Ask the AI for rules", description: hasLlm() ? llmModelId() : undefined,
      disabled: !hasLlm() ? "no model set up" : data.state.writingRules ? "asking now" : undefined,
      run: () => { toTransactions(ui); ui.setState({ ruleOffersOpen: true, ruleOfferCursor: data.allRuleOffers().length }); askForRules(ui, data) } },
    { id: "rules:apply", category: "Rules", label: "Apply all rules", description: "to every transaction", run: () => applyAllRules(ui, data) },
    { id: "rules:dry-run", category: "Rules", label: "Dry-run the rules", description: "what they'd change", run: () => showDryRun(ui, data) },
    // Data
    { id: "data:sync", category: "Data", label: "Sync with Up", key: "ctrl+r",
      disabled: !process.env.JASKMONEY_UP_TOKEN?.trim() ? "set JASKMONEY_UP_TOKEN" : data.state.upSyncing ? "syncing now" : undefined,
      run: () => { void runSync(ui, data, { manual: true }) } },
    { id: "data:import", category: "Data", label: "Import a CSV…", run: inSettings("database", "enter", () => ui.setState({ databaseCursor: DATABASE_ROWS.indexOf("import") })) },
    { id: "data:clear", category: "Data", label: "Clear transaction data…", description: "asks again", run: inSettings("database", "enter", () => ui.setState({ databaseCursor: DATABASE_ROWS.indexOf("clearData") })) },
    { id: "data:reset", category: "Data", label: "Reset the database…", description: "type RESET", run: inSettings("database", "enter", () => ui.setState({ databaseCursor: DATABASE_ROWS.indexOf("reset") })) },
    // Add
    { id: "add:category", category: "Add", label: "Category…", run: inSettings("taxonomy", "a", undefined, "categories") },
    { id: "add:tag", category: "Add", label: "Tag…", run: inSettings("taxonomy", "a", undefined, "tags") },
    { id: "add:rule", category: "Add", label: "Rule…", run: inSettings("rules", "a") },
    { id: "add:filter", category: "Add", label: "Saved filter…", run: inSettings("filters", "a") },
    { id: "add:budget", category: "Add", label: "Budget…", run: inSettings("budgets", "a") },
    // AI models
    ...AI_ROWS.map((row, i): Entry => ({
      id: `ai:${row}`, category: "AI models", label: `${aiRowLabel(row)}…`, description: isLlmRow(row) ? "sign in or key" : "key",
      run: inSettings("ai", "enter", () => ui.setState({ aiCursor: i })),
    })),
    // Display
    { id: "display:icons", category: "Display", label: `Category icons ${data.state.icons ? "off" : "on"}`, run: () => toggleIcons(ui, data) },
    { id: "display:week", category: "Display", label: `Weeks start ${data.state.weekStart === "monday" ? "Sunday" : "Monday"}`, run: () => toggleWeekStart(ui, data) },
    { id: "display:x-axis", category: "Display", label: `Charts' $0 line ${data.state.uiPrefs.xAxis ? "off" : "on"}`, run: () => toggleXAxis(ui, data) },
    // Settings
    { id: "settings:cycle", category: "Settings", label: "Budget cycle…", description: "e.g. from payday", run: inSettings("budgets", "enter", () => ui.setState({ budgetCursor: 0 })) },
    ...SETTINGS_SECTIONS.map((section): Entry => ({ id: `settings:${section}`, category: "Settings", label: SETTINGS_SECTION_LABELS[section], run: () => toSettings(section) })),
    // Go to
    ...TABS.map((tab): Entry => ({
      id: `go:${tab.id}`, category: "Go to", label: tab.label, key: tab.hotkey,
      disabled: ui.state.activeTab === tab.id ? "here now" : undefined, run: () => ui.switchTab(tab.id),
    })),
    { id: "go:jump", category: "Go to", label: "Jump to a pane", key: "v", run: () => ctx.press(keyEvent("v")) },
  ]
}

/** The pane's commands (its one-key hints, in their order), then the rest
 * of the registry. A hint naming a registry command lists that command,
 * keyed and run by its key here. */
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
    const run = () => ctx.press(event)
    return [linked
      ? { ...linked, key: hint.key, category: here, run }
      : { id: `key:${ctx.from}:${hint.key}`, label: hint.label ?? hint.desc[0]!.toUpperCase() + hint.desc.slice(1), description: hint.description, key: hint.key, category: here, run }]
  })
  return [...own, ...entries.filter((entry) => !used.has(entry.id) && !(entry.key && used.has(`key:${entry.key}`)))]
}

/** How well a command matches: every word fuzzily in its label (or id, or
 * key), else every word whole in its description or category, which counts
 * for less; null when neither. (A loose match across a description finds
 * nonsense: "undo" in "Reset the database… keeps filters and config".) */
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

/** The palette's list. With nothing typed: the last command run, the pane's,
 * then the registry's groups in order; those that can't run are left out.
 * With a query: the best matches, those that can't run last (with why). */
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
