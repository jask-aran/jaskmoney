import { triable, tryHints } from "../state/tour"
import { travel } from "./paneTravel"
import { footerShown, scopeLabel, type Hint } from "./palette"
import { reportError } from "./actions"
import { commands, rankCommands, type Command } from "./commands"
import { isSecondPress } from "../state/armed"
import { stripAnsiSequences, type KeyEvent } from "@opentui/core"
import { keyEvent } from "./keyEvent"
import { batch } from "solid-js"
import { accountRole } from "../domain/types"
import { editorFields } from "../state/settingsForm"
import { runSync } from "./sync"
import { BOUGHT_LINES } from "../ui/manager/TransactionDetail"
import { handleWelcome, welcomeContext } from "./welcome"
import { welcomeRows } from "../state/welcome"
import { budgetListInPane, budgetsHome, SETTINGS_SECTION_LABELS, SETTINGS_SECTIONS, jumpTargets, TABS, TAB_DEFAULT_FOCUS, smartQuestionFor, type ScopeId, type UiStore } from "../state/uiStore"
import type { DataStore } from "../state/dataStore"
import { stepUnit } from "../domain/timeframe"
import { characters } from "../domain/textField"
import { queryPickerKey, openBarItem, type HintState, type ScopeEntry } from "./keys/shared"
import { overviewScopes } from "./keys/overview"
import { managerScopes } from "./keys/manager"
import { budgetsScopes } from "./keys/budgets"
import { settingsScopes } from "./keys/settings"
import { settingsImportScopes } from "./keys/settingsImport"
import { aiScopes } from "./keys/ai"
import { pickersScopes } from "./keys/pickers"

/** ctrl+letters where letters are commands: the list keys readline and
 * vim users reach for, as the keys they stand for. */
const CTRL_ALIASES: Record<string, string> = { d: "pagedown", u: "pageup", n: "down", j: "down", p: "up" }

/** Scopes whose printable keys are text, so a paste can type into them. */
const PASTE_SCOPES = new Set<ScopeId>(["welcome", "merchantNote", "llmSignIn", "settings.aiDialog", "filter", "manager.detail.notes", "catPicker", "tagPicker", "filterPicker", "modelPicker", "settings.import.path", "settings.factoryReset"])

/** Whether a paste would land as text where input is now: never where
 * letters are commands (a pasted "x" must not dismiss anything). */
function pasteTarget(ui: UiStore, data?: DataStore): boolean {
  const scope = ui.activeScope()
  if (scope !== "settings.editor") return PASTE_SCOPES.has(scope)
  const kind = ui.state.settingsEditor?.kind
  if (!kind) return false
  if (ui.state.settingsEditor!.picker) return true
  const ctx = { accounts: data?.state.accounts ?? [], categories: data?.state.categories ?? [], tags: data?.state.tags ?? [], savedFilters: data?.state.savedFilters ?? [] }
  const fields = editorFields(kind, ui.state.settingsDraft, ctx)
  const field = fields[Math.min(ui.state.settingsEditor!.field, fields.length - 1)]
  return field?.kind === "text"
}

/** Type pasted text into the focused text field, one character at a time
 * (one line: breaks become spaces, control characters are dropped, and the
 * ends are trimmed: a copied key often brings a newline).
 * Returns whether it landed. */
export function handlePaste(ui: UiStore, text: string, data?: DataStore): boolean {
  if (!pasteTarget(ui, data)) return false
  // Colour and other escape codes go (OpenTUI's stripAnsiSequences: a bare
  // control-character strip left "[31m"), then breaks become spaces.
  const line = stripAnsiSequences(text).replace(/[\r\n\t]+/g, " ").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim()
  // A model's dialog on its actions: a paste is its key (not letters to
  // move by: a key's "j" or "k"), whichever action the cursor is on.
  const dialog = ui.state.aiDialog
  if (ui.activeScope() === "settings.aiDialog" && dialog && !dialog.field && !dialog.busy) {
    ui.setState("aiDialog", { field: { action: "key", value: line, caret: line.length }, note: null })
    return true
  }
  batch(() => {
    // A character at a time: graphemes, so "🏖️" arrives whole.
    for (const ch of characters(line)) handleKey(ui, { name: ch === " " ? "space" : ch, sequence: ch, ctrl: false, meta: false, shift: false, option: false } as KeyEvent, data)
  })
  return true
}

export function handleKey(ui: UiStore, key: KeyEvent, data?: DataStore): boolean {
  const { name, sequence: seq } = key
  if (key.ctrl && name === "c") return false
  // Sync from anywhere, including over overlays: it changes no UI state.
  if (key.ctrl && name === "r") {
    if (data) void runSync(ui, data, { manual: true })
    return true
  }
  // An armed row waits for its own key again; any other key disarms it.
  const armed = ui.state.armed
  if (armed && !isSecondPress(armed, name)) {
    ui.disarm()
    // Approved status-log deviation from Go: restore the previous message
    // by withdrawing this prompt, while keeping every entry in the log.
    ui.withdrawStatus(armed.promptId)
    if (name === "escape") { ui.setStatus("Cancelled"); return true }
  }
  const scope = ui.activeScope()
  const entry = scopes[scope]
  if (entry.list) {
    if (key.ctrl && name === "k") { ui.setState({ palette: { query: "", cursor: 0, from: scope, opened: ++paletteOpens } }); return true }
    // A ctrl or alt letter is never its bare letter here (ctrl+u isn't undo):
    // the list aliases move, the scope's own (ctrl+s, ctrl+l) pass, the
    // rest do nothing.
    if ((key.ctrl || key.meta) && /^[a-z]$/.test(name)) {
      const alias = key.ctrl && !key.meta ? CTRL_ALIASES[name] : undefined
      if (alias) {
        // Overview's ctrl aliases remain list moves; only arrow keys travel.
        const list = scope === "overview" || scope === "overview.range"
        const move = list && alias === "down" ? "j" : list && alias === "up" ? "k" : alias
        return handleKey(ui, keyEvent(move, { shift: key.shift }), data)
      }
      if (!key.ctrl || key.meta || !entry.hints(hintState(ui, data)).some((hint) => hint.key === `ctrl+${name}`)) return true
    }
    if (name === "v") {
      if (jumpTargets(ui.state).length) ui.enterJump()
      return true
    }
    for (const tab of TABS) {
      if (name === tab.hotkey || seq === tab.hotkey) { ui.switchTab(tab.id); return true }
    }
    if (name === "tab") { ui.cycleTab(key.shift ? -1 : 1); return true }
  }
  // One batch per key: a handler's several store writes update the screen
  // once, not once per write.
  batch(() => entry.handle(ui, key, data))
  return true
}

/** The palette's commands as listed now (app/commands), for the keys and
 * the component alike. */
export function paletteList(ui: UiStore, data?: DataStore): Command[] {
  const palette = ui.state.palette
  if (!palette || !data) return []
  // Built once per opening (it reads offers, accounts, keys, undo: ~7ms on
  // 1,200 rows) and ranked once per query, so a cursor move is free and
  // the rows keep their identity (nothing remounts).
  if (paletteBuilt?.opened !== palette.opened) {
    const ctx = { ui, data, from: palette.from, press: (event: KeyEvent, expected: ScopeId) => {
      if (ui.activeScope() !== expected) { ui.setStatus(`Command needs ${scopeLabel(expected)}; active scope is ${scopeLabel(ui.activeScope())}`, true); return }
      handleKey(ui, event, data)
    } }
    paletteBuilt = { opened: palette.opened, all: commands(ctx, footerHints(palette.from, hintState(ui, data))), query: null, ranked: [] }
  }
  if (paletteBuilt.query !== palette.query) paletteBuilt = { ...paletteBuilt, query: palette.query, ranked: rankCommands(paletteBuilt.all, palette.query, ui.state.lastCommandId) }
  return paletteBuilt.ranked
}

let paletteOpens = 0

let paletteBuilt: { opened: number; all: Command[]; query: string | null; ranked: Command[] } | null = null

/** The command palette: enter runs the command under the cursor once the
 * palette has closed (from the pane it opened over); one that can't run
 * says why and the palette stays. */
function handlePalette(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const palette = ui.state.palette
  if (!palette) return
  const list = paletteList(ui, data)
  queryPickerKey(key, palette, list.length, {
    close: () => { ui.setState({ palette: null }) },
    update: (next) => { ui.setState({ palette: { ...palette, ...next } }) },
    apply: () => {
      const command = list[palette.cursor]
      if (!command) return
      if (command.disabled) { ui.setStatus(`${command.label}: ${command.disabled}`); return }
      ui.setState({ palette: null, lastCommandId: command.id })
      try { command.run() } catch (error) { reportError(ui, error) }
    },
  })
}

/** Every hint for a scope: the palette's commands; the footer shows
 * footerShown's cut of them. */
export function footerHints(scope: ScopeId, state?: HintState): Hint[] {
  return scopes[scope].hints(state)
}

/** What the footer shows in a scope on a line `width` wide: the focused
 * pane's name and its hints, as many as fit, and whether "ctrl+k all"
 * shows at its right (the palette opens here). */
export function footerLine(scope: ScopeId, state?: HintState, width = Infinity): { pane: string | null; hints: Hint[]; palette: boolean } {
  // A Settings section is its pane.
  const section = SETTINGS_SECTIONS.find((x) => scope === `settings.${x}`)
  const pane = scopes[scope].pane?.(state) ?? (section ? SETTINGS_SECTION_LABELS[section] : null)
  return { pane, hints: footerShown(footerHints(scope, state), scopes[scope].list, width, pane), palette: scopes[scope].list }
}

export function hintState(ui: UiStore, data?: DataStore): HintState {
  return {
    focusedSection: ui.state.focusedSection,
    drillReturn: ui.state.drillReturn,
    chartViews: ui.state.chartViews,
    stepUnit: stepUnit(ui.state.timeframe),
    customRange: ui.state.timeframe.family === "custom",
    overviewCharts: ui.state.overviewCharts,
    rangeText: data?.state.uiPrefs.rangeText === true,
    rangeView: data?.state.uiPrefs.rangeView,
    budgetCyclePanes: ui.state.budgetCyclePanes,
    budgetListInPane: budgetListInPane(ui.state),
    uncategorisedOnly: data?.state.uncategorisedOnly,
    tagReview: !!data?.state.tagReview,
    signInPaste: !!ui.state.llmSignIn?.paste,
    aiField: !!ui.state.aiDialog?.field,
    executorWaiting: !!ui.state.executor?.waiting,
    welcomeStep: ui.state.welcome?.step,
    welcomeTyping: !!ui.state.welcome && !ui.state.welcome.busy && !!data && welcomeRows(ui.state.welcome, welcomeContext(data)).some((r) => r.action === "token"),
    welcomeBusy: !!ui.state.welcome?.busy,
    spendingAccounts: data ? data.state.accounts.filter((a) => accountRole(a) === "spending").length : 0,
    welcomeTry: ui.state.welcome?.trying ? ui.state.welcome.demo : null,
    welcomeTriable: !!ui.state.welcome && triable(ui.state.welcome.demo),
    boughtScrolls: (data?.transactions().find((t) => t.id === (ui.state.detail?.id ?? null))?.bought?.length ?? 0) > BOUGHT_LINES,
    searchHelp: { full: (ui.state.searchHelp?.full ?? false) },
    ruleOfferCount: data && ui.state.activeTab === "manager" ? data.ruleOfferCount() : 0,
    asks: !!data?.askCounts(),
    askLoose: data?.nearMissesShown(),
    recallQuestion: !!smartQuestionFor(ui.state, (ui.state.filterBar?.draft ?? "")),
  }
}

const scopes: Record<ScopeId, ScopeEntry> = {
  ...overviewScopes,
  ...managerScopes,
  ...budgetsScopes,
  ...settingsScopes,
  ...settingsImportScopes,
  ...aiScopes,
  ...pickersScopes,
  "palette": {
    handle: handlePalette,
    list: false,
    hints: () => [{ key: "↑↓ ^j/k", desc: "move" }, { key: "enter", desc: "run" }, { key: "esc", desc: "close" }, { key: "type", desc: "filter" }],
  },
  "welcome": {
    handle: handleWelcome,
    list: false,
    hints: (state) => state?.welcomeBusy ? [{ key: "esc", desc: "stop waiting" }]
      : state?.welcomeTry != null ? [...tryHints(state.welcomeTry), { key: "esc", desc: "back to the demo" }]
      : state?.welcomeTyping ? [{ key: "paste", desc: "your token" }, { key: "enter", desc: "connect" }, { key: "ctrl+o", desc: "open api.up.com.au" }, { key: "ctrl+n", desc: "skip" }, { key: "esc", desc: "back" }]
      : [...(state?.welcomeStep === "tour" ? [{ key: "←→", desc: "demos" }, ...(state.welcomeTriable ? [{ key: "t", desc: "try it" }] : [])] : []), { key: "↑↓", desc: "move" }, { key: "enter", desc: "choose" }, ...(state?.welcomeStep === "done" || state?.welcomeStep === "hello" ? [] : [{ key: "s", desc: "skip" }]), ...(state?.welcomeStep === "hello" ? [{ key: "b", desc: "backdrop" }] : []), { key: "esc", desc: state?.welcomeStep === "hello" ? "skip setup" : "back" }],
  },
  "bar": {
    list: true,
    handle: (ui, key, data) => {
      const { name } = key
      if (name === "left" || name === "right" || name === "up" || name === "down") travel(ui, name)
      else if (name === "return" || name === "enter") openBarItem(ui, data, ui.state.focusedSection)
      else if (name === "escape") ui.setState({ focusedSection: ui.state.activeTab === "budgets" ? budgetsHome(ui.state) : TAB_DEFAULT_FOCUS[ui.state.activeTab] })
    },
    hints: (state) => [
      { key: "←→", desc: "move" },
      { key: "enter", desc: state?.focusedSection === "bar.sync" ? "sync" : state?.focusedSection === "bar.version" ? "check for updates" : "switch" },
      { key: "↓", desc: "page" },
      { key: "esc", desc: "done" },
    ],
  },
}


export { moveTxnCursor, listMove, openTransaction, selectAccountRow, moveOverviewCategory, openBarItem, showVersion } from "./keys/shared"

export { markCustomCell, setCustomView, pageCustomCalendar, stepOverviewRange, handleOverviewRange, drillDown } from "./keys/overview"

export { UP_ROWS } from "./keys/settingsImport"
