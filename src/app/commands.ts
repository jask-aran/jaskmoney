import type { KeyEvent } from "@opentui/core"
import { hasLlm, llmModelId } from "../ai/llm"
import { accountRows } from "../domain/accountTree"
import { fuzzyScore } from "../domain/fuzzy"
import type { DataStore } from "../state/dataStore"
import { DATABASE_ROWS } from "../state/databaseRows"
import { SETTINGS_SECTIONS, TABS, type ScopeId, type UiState, type UiStore } from "../state/uiStore"
import { AI_ROWS, aiRowLabel, isLlmRow } from "./apiKeys"
import { keyEvent } from "./keyEvent"
import { hintEvent, type Hint } from "./palette"
import { toggleUncategorised } from "./suggest"
import { runSync } from "./sync"

/**
 * The command palette's commands (ctrl+k), after the legacy registry
 * (legacy/go/commands.go): each has a label and a description, says why
 * it can't run now (shown dimmed, listed last), and runs from wherever the
 * palette opened, going to the pane it needs first. Some have a key, shown
 * where that key works. Beside these, the pane's own keys (its hints) are
 * commands that press that key. The last command run comes first.
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
  /** Its key, and the scopes it works in (shown only there). */
  key?: { hint: string; scopes: ScopeId[] }
  /** Listed only where its key works (it acts on the cursor row there). */
  onlyThere?: boolean
  /** "Here" (the pane's own) or "Everywhere", for the grouped list. */
  group: "here" | "everywhere"
  /** Why it can't run now; undefined when it can. */
  disabled?: string
  run: () => void
}

type Section = UiState["settingsSection"]

const SECTION_LABELS: Record<Section, string> = {
  taxonomy: "Taxonomy", budgets: "Budgets", ai: "AI models", rules: "Rules",
  filters: "Saved filters", up: "Up Bank", database: "Database & Import",
}

const TXNS: ScopeId[] = ["manager.txns"]
const ROWS: ScopeId[] = ["manager.txns", "manager.merchants"]

/** Every registry command, then the pane's own keys not already among them. */
export function commands(ctx: CommandContext, hints: Hint[]): Command[] {
  const { ui, data } = ctx
  const status = (text: string, err = false) => ui.setStatus(text, err)
  const fail = (error: unknown) => status(error instanceof Error ? error.message : String(error), true)
  const toTransactions = () => {
    if (ui.state.activeTab !== "manager") ui.switchTab("manager")
    if (ui.state.focusedSection !== "mgr.transactions") ui.setState({ focusedSection: "mgr.transactions" })
  }
  const toSettings = (section: Section, list: "categories" | "tags" = "categories") => {
    if (ui.state.activeTab !== "settings") ui.switchTab("settings")
    ui.activateSettings(section, list)
  }
  const resetCursors = () => { ui.jumpManagerCursor(0, data.scopedTransactions().length); ui.setState({ merchantCursor: 0, merchantTop: 0 }) }
  const filter = data.state.filterQuery
  const undo = data.undoLabel()
  const offers = data.allRuleOffers().length

  const press = (hint: string) => () => ctx.press(hintEvent(hint)!)
  const registry: Omit<Command, "group">[] = [
    // The table's own: on the cursor row or the selection, so only there.
    { id: "txn:category", label: "Categorise…", description: "the selection, or the cursor row", key: { hint: "c", scopes: ROWS }, onlyThere: true, run: press("c") },
    { id: "txn:tag", label: "Tag…", description: "add or remove tags on the selection or cursor row", key: { hint: "t", scopes: ROWS }, onlyThere: true, run: press("t") },
    { id: "txn:select", label: "Select the row", description: "or unselect it; S-j/k selects a range", key: { hint: "space", scopes: TXNS }, onlyThere: true, run: press("space") },
    { id: "txn:detail", label: "Open the transaction", description: "its details, notes and category", key: { hint: "enter", scopes: TXNS }, onlyThere: true, run: press("enter") },
    { id: "txn:merchants", label: "Group by merchant", description: "totals, counts and averages per merchant", key: { hint: "m", scopes: TXNS }, onlyThere: true, run: press("m") },
    { id: "txn:rows", label: "Back to the rows", key: { hint: "m", scopes: ["manager.merchants"] }, onlyThere: true, run: press("m") },
    { id: "txn:account", label: "Next account", description: "step the accounts pane", key: { hint: "a", scopes: ROWS }, onlyThere: true, run: press("a") },
    { id: "txn:sort", label: "Cycle the sort", description: "date, amount, description, category", key: { hint: "s", scopes: ROWS }, onlyThere: true, run: press("s") },
    { id: "txn:reverse", label: "Reverse the sort", key: { hint: "S-s", scopes: TXNS }, onlyThere: true, run: press("S-s") },
    { id: "txn:saved-filters", label: "Pick a saved filter…", description: "most recently used first", key: { hint: "ctrl+l", scopes: ROWS }, onlyThere: true, run: press("ctrl+l") },
    { id: "txn:top", label: "Go to the top", key: { hint: "g", scopes: TXNS }, onlyThere: true, run: press("g") },
    { id: "txn:bottom", label: "Go to the bottom", key: { hint: "G", scopes: TXNS }, onlyThere: true, run: press("G") },
    // Transactions
    { id: "txn:uncategorised", label: "Review uncategorised", description: "the rows waiting for a category, with suggestions to accept", key: { hint: "i", scopes: TXNS },
      disabled: data.state.uncategorisedOnly && ui.state.activeTab === "manager" ? "already showing them" : undefined,
      run: () => { toTransactions(); if (data.state.tagReview) data.closeTagReview(); if (!data.state.uncategorisedOnly) toggleUncategorised(ui, data) } },
    { id: "txn:tag-review", label: "Find transactions for a tag…", description: "candidates for a tag of yours, a trip or subscriptions found, or a new one", key: { hint: "T", scopes: TXNS },
      run: () => { toTransactions(); ctx.press(keyEvent("t", { shift: true, sequence: "T" })) } },
    { id: "edit:undo", label: undo ? `Undo: ${undo}` : "Undo", description: "the last change in Transactions, in Up too", key: { hint: "u", scopes: ROWS },
      disabled: undo ? undefined : "nothing to undo",
      run: () => { void data.undo().then((summary) => status(summary, summary.includes("failed:")), fail) } },
    { id: "edit:repeat", label: "Repeat the last change", description: "its category or tags on the cursor row or selection", key: { hint: ".", scopes: TXNS },
      disabled: ctx.from !== "manager.txns" ? "in the Transactions table" : data.lastRepeat() ? undefined : "nothing to repeat yet",
      run: () => ctx.press(keyEvent(".", { sequence: "." })) },
    { id: "filter:open", label: "Filter transactions…", description: "an expression: desc:coffee amt:>20 date:2026-10", key: { hint: "/", scopes: ROWS },
      run: () => { toTransactions(); ui.openFilter(data.state.filterQuery) } },
    { id: "filter:smart", label: "Smart search…", description: "a question in words, turned into a filter", key: { hint: "?", scopes: ROWS },
      run: () => { toTransactions(); ctx.press(keyEvent("?", { sequence: "?" })) } },
    { id: "filter:clear", label: "Clear the filter", description: filter || undefined, disabled: filter ? undefined : "no filter",
      run: () => { data.clearFilter(); resetCursors(); status("Filter cleared") } },
    { id: "filter:save", label: "Save the filter…", description: filter || undefined, key: { hint: "ctrl+s", scopes: ROWS }, disabled: filter ? undefined : "no filter to save",
      run: () => { toTransactions(); ctx.press(keyEvent("s", { ctrl: true, sequence: "" })) } },
    ...data.state.savedFilters.map((saved) => ({
      id: `filter:saved:${saved.id}`, label: `Filter: ${saved.name}`, description: saved.expr,
      disabled: filter === saved.expr ? "applied now" : undefined,
      run: () => {
        toTransactions()
        const result = data.commitFilter(saved.expr)
        if (!result.ok) { status(result.err, true); return }
        resetCursors()
        try { data.recordFilterUsage(saved.id); status(`Filter: ${saved.name}`) } catch (error) { fail(error) }
      },
    })),
    ...accountRows(data.state.accounts).map((row) => ({
      id: `account:${row.selection}`, label: `Show ${row.label}`, description: "in the Transactions table",
      disabled: data.state.accountSelection === row.selection ? "showing it now" : undefined,
      run: () => { toTransactions(); data.setAccountSelection(row.selection); resetCursors(); status(`Showing ${row.label}`) },
    })),
    // Rules
    { id: "rules:offers", label: offers ? `Rules offered (${offers})…` : "Rules offered…", description: "rules from what you categorise the same way, to make or turn down", key: { hint: "R", scopes: TXNS },
      disabled: offers || hasLlm() ? undefined : "none yet: one comes after the same description gets the same category 3 times",
      run: () => { toTransactions(); ctx.press(keyEvent("r", { shift: true, sequence: "R" })) } },
    { id: "rules:ask-ai", label: "Ask the AI for rules", description: hasLlm() ? `${llmModelId()} reads your history and offers rules` : undefined,
      disabled: !hasLlm() ? "set up a model in Settings › AI models" : data.state.writingRules ? "already asking" : undefined,
      run: () => {
        toTransactions()
        ui.setState({ ruleOffersOpen: true, ruleOfferCursor: data.allRuleOffers().length })
        status(`Asking ${llmModelId()} for rules…`)
        data.askForRules().then((summary) => status(summary), fail)
      } },
    { id: "rules:apply", label: "Apply all rules", description: "every enabled rule, over every transaction", key: { hint: "S-a", scopes: ["settings.rules"] },
      run: () => { const r = data.applyRules(); status(`Rules applied · ${r.updatedTransactions} transactions`) } },
    { id: "rules:dry-run", label: "Dry-run the rules", description: "what each rule would change, changing nothing", key: { hint: "S-d", scopes: ["settings.rules"] },
      run: () => { ui.setState({ dryRunReport: data.dryRunRules(), dryRunScroll: 0 }) } },
    // Data
    { id: "sync:now", label: "Sync with Up now", description: "fetch new transactions and balances", key: { hint: "ctrl+r", scopes: [] },
      disabled: !process.env.JASKMONEY_UP_TOKEN?.trim() ? "set JASKMONEY_UP_TOKEN" : data.state.upSyncing ? "syncing now" : undefined,
      run: () => { void runSync(ui, data, { manual: true }) } },
    { id: "import:csv", label: "Import a CSV…", description: "pick a file, map it with a profile, preview, then import",
      run: () => { toSettings("database"); ui.setState({ databaseCursor: DATABASE_ROWS.indexOf("import") }); ctx.press(keyEvent("return")) } },
    // Settings
    { id: "add:category", label: "Add a category…", run: () => { toSettings("taxonomy", "categories"); ctx.press(keyEvent("a")) } },
    { id: "add:tag", label: "Add a tag…", description: "with a scope (a filter) if it belongs to a trip or a category", run: () => { toSettings("taxonomy", "tags"); ctx.press(keyEvent("a")) } },
    { id: "add:rule", label: "Add a rule…", description: "a saved filter's rows get a category or tags", run: () => { toSettings("rules"); ctx.press(keyEvent("a")) } },
    { id: "add:filter", label: "Add a saved filter…", run: () => { toSettings("filters"); ctx.press(keyEvent("a")) } },
    { id: "add:budget", label: "Add a budget…", run: () => { toSettings("budgets"); ctx.press(keyEvent("a")) } },
    { id: "budget:cycle", label: "Edit the budget cycle…", description: "when a cycle starts (e.g. payday)", run: () => { toSettings("budgets"); ui.setState({ budgetCursor: 0 }); ctx.press(keyEvent("return")) } },
    ...AI_ROWS.map((row, i) => ({
      id: `ai:${row}`, label: `Set up ${aiRowLabel(row)}…`, description: isLlmRow(row) ? "sign in or paste a key, test it, choose the model" : "paste a key, test it",
      run: () => { toSettings("ai"); ui.setState({ aiCursor: i }); ctx.press(keyEvent("return")) },
    })),
    { id: "prefs:icons", label: `Category icons: turn ${data.state.icons ? "off" : "on"}`, description: "they need a Nerd Font",
      run: () => { data.setIcons(!data.state.icons); status(data.state.icons ? "Category icons on (needs a Nerd Font)" : "Category icons off") } },
    { id: "prefs:week", label: `Start weeks on ${data.state.weekStart === "monday" ? "Sunday" : "Monday"}`,
      run: () => { data.saveUiPrefs({ weekStart: data.state.weekStart === "monday" ? "sunday" : "monday" }); status(data.state.weekStart === "sunday" ? "Weeks start on Sunday" : "Weeks start on Monday") } },
    { id: "prefs:x-axis", label: `Charts' $0 line: turn ${data.state.uiPrefs.xAxis ? "off" : "on"}`,
      run: () => { data.saveUiPrefs({ xAxis: !data.state.uiPrefs.xAxis }); status(data.state.uiPrefs.xAxis ? "Charts draw an x-axis line" : "Charts without an x-axis line") } },
    { id: "data:clear", label: "Clear transaction and import data…", description: "asks again (enter) first",
      run: () => { toSettings("database"); ui.setState({ databaseCursor: DATABASE_ROWS.indexOf("clearData") }); ctx.press(keyEvent("return")) } },
    { id: "data:reset", label: "Reset the database…", description: "asks you to type RESET; keeps filters and config",
      run: () => { toSettings("database"); ui.setState({ databaseCursor: DATABASE_ROWS.indexOf("reset") }); ctx.press(keyEvent("return")) } },
    ...SETTINGS_SECTIONS.map((section) => ({
      id: `settings:${section}`, label: `Settings › ${SECTION_LABELS[section]}`,
      run: () => toSettings(section),
    })),
    // Navigation
    ...TABS.map((tab) => ({
      id: `nav:${tab.id}`, label: `Go to ${tab.label}`, key: { hint: tab.hotkey, scopes: [] as ScopeId[] },
      disabled: ui.state.activeTab === tab.id ? "here now" : undefined,
      run: () => ui.switchTab(tab.id),
    })),
    { id: "nav:jump", label: "Jump to a pane", description: "a letter per pane", key: { hint: "v", scopes: [] }, run: () => ctx.press(keyEvent("v")) },
  ]

  // A key with no scopes works everywhere; otherwise it shows only where it works.
  const keyHere = (command: Omit<Command, "group">) => !!command.key && (!command.key.scopes.length || command.key.scopes.includes(ctx.from))
  const listed: Command[] = registry.filter((command) => !command.onlyThere || command.key?.scopes.includes(ctx.from)).map((command) => ({
    ...command,
    key: command.key && keyHere(command) ? command.key : undefined,
    group: command.key?.scopes.includes(ctx.from) ? "here" : "everywhere",
  }))
  const taken = new Set(listed.flatMap((c) => c.key ? [c.key.hint] : []))
  // The pane's own keys the registry doesn't have: pressed where the palette opened.
  const own: Command[] = hints.flatMap((hint) => {
    const event = hintEvent(hint.key)
    if (!event || hint.key === "esc" || taken.has(hint.key)) return []
    taken.add(hint.key)
    return [{ id: `key:${ctx.from}:${hint.key}`, label: hint.desc[0]!.toUpperCase() + hint.desc.slice(1), key: { hint: hint.key, scopes: [ctx.from] }, group: "here" as const, run: () => ctx.press(event) }]
  })
  return [...own, ...listed]
}

/** How well a command matches: every word fuzzily in its label (or id, or
 * key), else every word whole in its description, which counts for less;
 * null when neither. (A loose match across a description finds nonsense:
 * "undo" in "Reset the database… keeps filters and config".) */
function commandScore(command: Command, query: string): number | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const fuzzy = (text: string) => {
    let total = 0
    for (const word of words) { const score = fuzzyScore(word, text); if (score == null) return null; total += score }
    return total
  }
  const named = [command.label, command.id, command.key?.hint ?? ""].map(fuzzy).filter((s): s is number => s != null)
  if (named.length) return Math.max(...named) + 100
  const description = (command.description ?? "").toLowerCase()
  return description && words.every((word) => description.includes(word)) ? words.length : null
}

/** The palette's list for a query: with none, this pane's commands then the
 * rest; with one, the best matches (label, description, id). Either way the
 * last command run comes first and those that can't run come last. */
export function rankCommands(list: Command[], query: string, lastId: string | null): Command[] {
  const q = query.trim()
  const scored = list.flatMap((command, order) => {
    if (!q) return [{ command, order, score: 0 }]
    const score = commandScore(command, q)
    return score == null ? [] : [{ command, order, score }]
  })
  const rank = (entry: (typeof scored)[number]) => [
    entry.command.disabled ? 1 : 0,
    entry.command.id === lastId ? 0 : 1,
    q ? -entry.score : entry.command.group === "here" ? 0 : 1,
    entry.order,
  ]
  return scored.sort((a, b) => {
    const ra = rank(a), rb = rank(b)
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i]! - rb[i]!
    return 0
  }).map((entry) => entry.command)
}
