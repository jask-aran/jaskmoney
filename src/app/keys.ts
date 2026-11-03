import { APPEARANCE_ROWS } from "../state/appearanceRows"
import { THEMES } from "../themes"
import { applyTheme } from "../theme"
import { triable, tryHints } from "../state/tour"
import { travel } from "./paneTravel"
import { chooseModel, modelItems, openModelPicker } from "./modelPicker"
import { regionRects } from "../ui/regions"
import { nearestRegion } from "../state/spatial"
import { web } from "./webApp"
import { describeVersion } from "./updates"
import { unwrap } from "solid-js/store"
import { merchantKey } from "../domain/history"
import { footerShown, scopeLabel, type Hint } from "./palette"
import { changeAccountScope, toTransactions, toggleDemo, applyAllRules, applySavedFilter, clearTransactionFilter, askForRules, reportError, settleData, resetTransactionCursors, runUndo, showAccount, showDryRun, toggleIcons, toggleWeekStart, toggleXAxis, openThemePicker, keepTheme, toggleChartMotion, cycleChartSpeed, cycleChartCurve, toggleChartLabels, cycleOpenRange, cycleBackdrop } from "./actions"
import { commands, rankCommands, type Command } from "./commands"
import { ACCOUNT_ACTIONS, armedText, isArmed, isSecondPress, type Armed } from "../state/armed"
import { DATABASE_ROWS } from "../state/databaseRows"
import { stripAnsiSequences, type KeyEvent } from "@opentui/core"
import { keyEvent } from "./keyEvent"
import { resolve } from "node:path"
import { batch } from "solid-js"
import { accountRole } from "../domain/types"
import { accountRows, accountStacks, spendingScope, type AccountSelection } from "../domain/accountTree"
import { assignableCategories, pickerSuggestions } from "../domain/categoryOptions"
import { tagChoices } from "../state/tagChooser"
import { RULE_AFTER } from "../domain/ruleOffers"
import { endTagReview, runTagAccept, startTagReview } from "./tagReview"
import { budgetLabel, budgetScopeOptions, scopeKey, scopeOfKey } from "../domain/budgetScopes"
import { budgetIgnoredIds, cycleAt, type Budget, type BudgetScope, type CycleConfig } from "../domain/budget"
import { budgetArmId, budgetListRows, budgetSetupRows, type BudgetLine, type SetupRow } from "../domain/budgetLines"
import { sharedBudgetView, sharedCategoryLines } from "../state/budgetViews"
import { MERCHANT_SORTS, groupByMerchant, merchantFilter, sortMerchantGroups } from "../domain/merchants"
import { anchorDraft, cycleFromDraft, editorFields, normaliseCycleDraft, pickerChoices, pickerItems, stepChoice } from "../state/settingsForm"
import { runSync } from "./sync"
import { runSmartSearch } from "./smartSearch"
import { searchReport, writtenText } from "./searchReport"
import { SEARCH_HELP, SEARCH_HELP_FULL } from "../state/searchHelp"
import { previewSent } from "./sentPreview"
import { runAsk } from "./ask"
import { eitherInstead, askTerms } from "../domain/filter"
import { BOUGHT_LINES } from "../ui/manager/TransactionDetail"
import { cancelExecutorSignIn, openExecutorDialog, runExecutorAction } from "./executorSource"
import { handleWelcome, openWelcome, welcomeContext } from "./welcome"
import { welcomeRows } from "../state/welcome"
import { executorActions } from "../state/executorDialog"
import { AI_ROWS, aiRowLabel, isLlmRow, testAi } from "./apiKeys"
import { KEY_PAGES, aiPaneRows, aiActions, aiContext, aiDialogFor, useActions, type AiUse } from "../state/aiDialog"
import { useQueries, type QueryId } from "../ai/catalog"
import { hasWorkersAi } from "../ai/workersAi"
import { cancelLlmSignIn, openBrowser, signOutLlm, startLlmSignIn, submitSignInPaste } from "./llmSignIn"
import { createLlm, LLM_PROVIDERS } from "../ai/llm"
import { credentialEnv } from "../ai/credentials"
import { runAccept, toggleUncategorised, newSuggestionsNote, suggestNew } from "./suggest"
import { ACCEPT_ALL_AT } from "../domain/questions"
import { categoryRows } from "../state/taxonomyRows"
import { IMPORT_HISTORY_ROWS } from "../state/databaseRows"
import { BUDGET_PANES, BUDGET_VIEWS, CHART_VIEWS, CYCLE_VIEWS, chartPaneOf, type ChartViews, type OverviewCharts, SETTINGS_RIGHT, SETTINGS_SECTIONS, type SettingsSection, jumpTargets, TABS, TAB_DEFAULT_FOCUS, settingsSectionFocus, smartQuestionFor, type ScopeId, type UiState, type UiStore } from "../state/uiStore"
import type { DataStore } from "../state/dataStore"
import {
  CUSTOM_CHIP,
  LOOKBACKS,
  PERIOD_LABEL,
  activeChipIndex,
  applyChip,
  chipCount,
  chipLabel,
  stepChip,
  readCustomRange,
  rangeOffsetLabel,
  stepRange,
  stepUnit,
  timeframeBounds,
  timeframeNow,
  type TimeframeState,
} from "../domain/timeframe"
import { characters, editText, isPrintable, textField } from "../domain/textField"
import { appNow, appToday } from "../domain/days"
import { amountFromText, rangeDayFromText, rangeDayText } from "../domain/typedInput"
import { CALENDAR_VIEWS, CUSTOM_FOCUS_ORDER, leftHalf, markedRange, moveCursor, pageCursor, rowStep, unitOf, type CalendarView, type CustomFocus } from "../domain/rangeCalendar"
import { drillFilter } from "../domain/drill"
import type { CategoryLine } from "../domain/dashboard"
import { allCategoryLines, overviewRange } from "../state/overviewRange"
import { tagPickerItems, tagPickerState } from "../state/tagPicker"
import { savedFilterOptions } from "../state/savedFilters"
import { nextSettingsId, nextSavedFilterId } from "../state/settingsConfig"
import { theme } from "../theme"
import { count, shortDate } from "../ui/text"


function defaultProfile(id: string, path: string) {
  const name = path.split(/[\\/]/).pop()?.replace(/\.csv$/i, "") || "CSV import"
  return { id, name, account: "", accountType: "debit" as const, importPrefix: name.toLowerCase(), hasHeader: true, delimiter: ",", dateColumn: 0, amountColumn: 1, descriptionColumns: [2], descriptionJoin: false, amountStrip: "$", dateFormat: "DMY" as const }
}

export function moveTxnCursor(
  ui: UiStore,
  data: DataStore | undefined,
  delta: number,
  withRange: boolean,
) {
  const rows = data?.scopedTransactions() ?? []
  if (rows.length === 0) { ui.jumpManagerCursor(0, 0); return }
  const prev = rows[ui.state.managerCursor]
  ui.moveManagerCursor(delta, rows.length)
  const cur = rows[ui.state.managerCursor]
  if (!cur) return
  if (withRange) {
    const anchorId = ui.state.range?.anchorId ?? prev?.id ?? cur.id
    ui.setRangeFromMove(anchorId, cur.id, true)
  } else if (ui.state.range) {
    ui.setRangeFromMove(0, 0, false)
  }
}

/** A list filtered by typing (saved filters, categories, tags, a form's
 * picker field): every printable key types into the query, so arrows and
 * ctrl+n/ctrl+p move. Approved deviation from the Go app, whose pickers
 * moved on j/k: a search must take any letter. */
function queryPickerKey(
  key: KeyEvent,
  picker: { query: string; cursor: number },
  length: number,
  actions: {
    close: () => void
    update: (next: { query: string; cursor: number }) => void
    apply: () => void
    space?: () => void
  },
): void {
  if (key.name === "escape") { actions.close(); return }
  if (actions.space && (key.name === "space" || key.sequence === " ")) { actions.space(); return }
  const step = key.name === "down" || (key.ctrl && (key.name === "n" || key.name === "j")) ? 1 : key.name === "up" || (key.ctrl && (key.name === "p" || key.name === "k")) ? -1
    : key.name === "pagedown" ? PAGE : key.name === "pageup" ? -PAGE : key.name === "end" ? length : key.name === "home" ? -length : 0
  if (step) { actions.update({ ...picker, cursor: Math.max(0, Math.min(length - 1, picker.cursor + step)) }); return }
  if (key.name === "return" || key.name === "enter") { actions.apply(); return }
  if (key.name === "backspace") { actions.update({ query: characters(picker.query).slice(0, -1).join(""), cursor: 0 }); return }
  if (isPrintable(key)) actions.update({ query: picker.query + key.sequence, cursor: 0 })
}

/** Rows a page key moves where a list doesn't say how many it shows. */
const PAGE = 10

/** Every list's movement: j/k and the arrows a row, pageup/pagedown (and
 * ctrl+u/ctrl+d, see handleKey) a page, g/home the top, G/end the bottom.
 * List indices remain zero for empty lists. Callers include any extra create row. */
export function listMove(key: Pick<KeyEvent, "name" | "sequence" | "shift">, cursor: number, length: number, page = PAGE): number | null {
  const last = Math.max(0, length - 1)
  let next: number
  if (key.sequence === "G" || (key.name === "g" && key.shift) || key.name === "end") next = last
  else if (key.name === "g" || key.name === "home") next = 0
  else if (key.name === "j" || key.name === "down") next = cursor + 1
  else if (key.name === "k" || key.name === "up") next = cursor - 1
  else if (key.name === "pagedown") next = cursor + Math.max(1, page)
  else if (key.name === "pageup") next = cursor - Math.max(1, page)
  else return null
  return Math.max(0, Math.min(last, next))
}

/** A move to the top or bottom (g, G, home, end), not a step. */
function isJump(key: Pick<KeyEvent, "name" | "sequence">): boolean {
  return key.name === "g" || key.sequence === "G" || key.name === "home" || key.name === "end"
}

/** ctrl+letters where letters are commands: the list keys readline and
 * vim users reach for, as the keys they stand for. */
const CTRL_ALIASES: Record<string, string> = { d: "pagedown", u: "pageup", n: "down", j: "down", p: "up" }

/** A shifted letter, as terminals report it: the capital, or the letter with shift. */
function shifted(key: Pick<KeyEvent, "name" | "sequence" | "shift">, letter: string): boolean {
  return key.sequence === letter.toUpperCase() || (key.name === letter && key.shift)
}

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

function handleFilterPicker(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const picker = ui.state.filterPicker
  if (!picker) return
  const items = savedFilterOptions(data?.state.savedFilters ?? [], data?.state.uiPrefs.filterUsage, picker.query)
  queryPickerKey(key, picker, items.length, {
    close: () => { ui.setState({ filterPicker: null }) },
    update: (next) => { ui.setState({ filterPicker: next }) },
    apply: () => {
      const filter = items[picker.cursor]
      if (filter && data && applySavedFilter(ui, data, filter)) {
        ui.setState({ filterPicker: null })
      }
    },
  })
}

/** The theme picker: moving shows the theme at the cursor; enter keeps it;
 * esc closes, and App puts the saved theme back. */
function handleThemePicker(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const picker = ui.state.themePicker
  if (!picker) return
  if (key.name === "escape") { ui.setState({ themePicker: null }); return }
  if (key.name === "return" || key.name === "enter") { if (data) keepTheme(ui, data, THEMES[picker.cursor]!.id); return }
  const moved = listMove(key, picker.cursor, THEMES.length) ?? (key.ctrl && key.name === "j" ? Math.min(THEMES.length - 1, picker.cursor + 1) : key.ctrl && key.name === "k" ? Math.max(0, picker.cursor - 1) : null)
  if (moved == null || moved === picker.cursor) return
  ui.setState({ themePicker: { cursor: moved } })
  applyTheme(THEMES[moved]!.id)
}

/** The model picker: type to filter, ↑↓ move, enter use it, esc leave it as it was. */
function handleModelPicker(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const picker = ui.state.modelPicker
  if (!picker || !data) return
  const choices = pickerChoices(modelItems(picker.provider, picker.query))
  queryPickerKey(key, picker, choices.length, {
    close: () => ui.setState({ modelPicker: null }),
    update: (next) => ui.setState("modelPicker", next),
    apply: () => { const choice = choices[picker.cursor]; if (choice) chooseModel(ui, data, picker.provider, String(choice.value)) },
  })
}

function handleDryRun(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  if (key.name === "escape") { ui.setState({ dryRun: null }); return }
  // Scrolls like a list whose rows are the scroll positions.
  const lines = ui.state.dryRun?.report?.rules.reduce((n, result) => n + 4 + result.samples.length, 0) ?? 0
  const moved = listMove(key, (ui.state.dryRun?.scroll ?? 0), Math.max(0, lines - (ui.state.dryRun?.visible ?? 10)) + 1, (ui.state.dryRun?.visible ?? 10))
  if (moved != null) ui.setState("dryRun", { scroll: moved })
}

function handleJump(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name, sequence: seq } = key
  if (name === "escape" || name === "v") {
    ui.cancelJump()
    return
  }
  const hit = jumpTargets(ui.state).find(
    (t) => t.key === name || t.key === seq,
  )
  if (hit) {
    if (ui.state.activeTab === "settings") {
      if (hit.section === "set.categories") ui.activateSettings("taxonomy", "categories", true)
      else if (hit.section === "set.tags") ui.activateSettings("taxonomy", "tags", true)
      else if (hit.section === "set.rules") ui.activateSettings("rules")
      else if (hit.section === "set.filters") ui.activateSettings("filters")
      else if (hit.section === "set.appearance") ui.activateSettings("appearance")
      else if (hit.section === "set.database") ui.activateSettings("database")
      else if (hit.section === "set.up") ui.activateSettings("up")
      else if (hit.section === "set.web") ui.activateSettings("web")
      else if (hit.section === "set.ai") ui.activateSettings("ai")
      return
    }
    ui.applyJump(hit.section)
    return
  }
}

function handleTagPicker(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const dialog = ui.state.tagPicker
  if (!dialog || dialog.applying) return
  const opened = ui.opening("tagPicker")
  const items = pickerChoices(tagPickerItems(data?.state.tags ?? [], data?.state.categories ?? [], data?.transactions() ?? [], ui.state.pickerTargets, dialog.query))
  queryPickerKey(key, { query: dialog.query, cursor: dialog.cursor }, items.length, {
    close: () => { opened.close(); ui.setStatus("Tags unchanged") },
    update: (next) => { opened.patch({ query: next.query, cursor: next.cursor }) },
    apply: () => {
      const targets = [...ui.state.pickerTargets]
      const patch = { ...dialog.patch }
      settleData(ui, (async () => {
        if (items[dialog.cursor]?.value === null && data) {
          const id = await data.createSettingsTag({ name: dialog.query.trim(), color: theme.blue })
          if (!opened.open) return
          patch[id] = "add"
          opened.patch({ patch })
        }
        // Approved deviation from Go: enter without staged changes makes no edit.
        if (!data || !Object.keys(patch).length) {
          opened.close()
          ui.setStatus("Tags unchanged")
        } else {
          opened.patch({ applying: true })
          data.applyTagPatch(targets, patch).then(
            (summary) => { opened.close(); ui.setStatus(summary, summary.includes(" failed: ")) },
            (error) => { opened.close(); reportError(ui, error) },
          )
        }
      })())
    },
    space: () => {
      const item = items[dialog.cursor]
      const targets = ui.state.pickerTargets
      if (item && typeof item.value === "number" && data && targets.length) {
        const id = item.value
        const base = tagPickerState(data.transactions(), targets, id)
        const patch = { ...dialog.patch }
        const current = patch[id]
        // Approved deviation from Go: mixed tags cycle back to their original state.
        if (base === "some") {
          if (!current) patch[id] = "add"
          else if (current === "add") patch[id] = "remove"
          else delete patch[id]
        } else if (current) delete patch[id]
        else patch[id] = base === "all" ? "remove" : "add"
        opened.patch({ patch })
      }
    },
  })
}

/** T: choose a tag (or a group found in the history, or a new name) to
 * find transactions for. */
function handleTagChooser(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const choices = data ? tagChoices(data.state.tags, data.tagGroups(), (ui.state.tagChooser?.query ?? "")) : []
  queryPickerKey(key, { query: (ui.state.tagChooser?.query ?? ""), cursor: (ui.state.tagChooser?.cursor ?? 0) }, choices.length, {
    close: () => { ui.setState({ tagChooser: null }); ui.setStatus("Transactions") },
    update: (next) => { ui.setState({ tagChooser: { query: next.query, cursor: next.cursor } }) },
    apply: () => {
      const choice = choices[(ui.state.tagChooser?.cursor ?? 0)]
      ui.setState({ tagChooser: null })
      if (choice && data) void startTagReview(ui, data, choice)
    },
  })
}

function openCategoryPicker(ui: UiStore, ids: number[], data?: DataStore): void {
  ui.openCatPicker(ids)
  const repeat = data?.lastRepeat()
  if (!data || repeat?.kind !== "category" || (ui.state.catPicker?.query ?? "") || ids.some((id) => data.state.suggestions[id])) return
  // Start on the last category chosen (the list keeps its order).
  const cursor = assignableCategories(data.state.categories, "", pickerSuggestions(ids, data.state.suggestions)).findIndex((c) => c.id === repeat.categoryId)
  if (cursor >= 0) ui.setState("catPicker", { cursor })
}

function handleCatPicker(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const cats = assignableCategories(data?.state.categories ?? [], (ui.state.catPicker?.query ?? ""), pickerSuggestions(ui.state.pickerTargets, data?.state.suggestions ?? {}))
  queryPickerKey(key, { query: (ui.state.catPicker?.query ?? ""), cursor: (ui.state.catPicker?.cursor ?? 0) }, cats.length, {
    close: () => { ui.closeCatPicker(); ui.setStatus("Categorize cancelled") },
    update: (next) => { ui.setState({ catPicker: { query: next.query, cursor: next.cursor } }) },
    apply: () => {
      const cat = cats[(ui.state.catPicker?.cursor ?? 0)]
      // Targets were fixed when the picker opened (the Transactions
      // selection or cursor row, the open detail row, or a merchant group).
      const targets = ui.state.pickerTargets
      if (cat && data && targets.length) {
        ui.closeCatPicker()
        ui.setStatus(`Categorizing ${targets.length} → ${cat.name}…`)
        let resuggest: Promise<string> | undefined
        data.categorizeTransactions(targets, cat.id, (pushed, total) => {
          // In the Uncategorised view the rows have left: they leave the
          // selection too, as y's do, so nothing unseen stays selected.
          if (pushed === 0 && data.state.uncategorisedOnly) {
            const left = new Set(targets)
            ui.setState({ selectedIds: Object.fromEntries(Object.entries(ui.state.selectedIds).filter(([id]) => !left.has(Number(id)))) })
          }
          if (pushed === 0) resuggest ??= data.resuggestLike(targets).then(
            (count) => count > 0 ? ` · re-suggested ${count} alike` : "",
            (error) => ` · re-suggest failed: ${error instanceof Error ? error.message : String(error)}`,
          )
          if (total) ui.setStatus(`Categorized ${targets.length} → ${cat.name} · updating Up ${pushed}/${total}…`)
        }).then(
          async (summary) => {
            const failed = summary.includes(" failed: ")
            summary += await (resuggest ?? "")
            ui.setStatus(summary, failed)
          },
          (error) => reportError(ui, error),
        )
      } else {
        ui.closeCatPicker()
        ui.setStatus("Nothing to categorize", true)
      }
    },
  })
}

function handleFilter(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  if (name === "f1") { ui.setState({ searchHelp: { full: false, top: 0, visible: 0 } }); return }
  // ↑ on a smart search's filter brings its question back, to reword it.
  const question = smartQuestionFor(ui.state, (ui.state.filterBar?.draft ?? ""))
  if (name === "up" && question) {
    const draft = `?${question}`
    ui.setState({ filterBar: { draft, caret: draft.length } })
    ui.setStatus("Reword the question · enter asks again")
    return
  }
  if (name === "escape") {
    ui.setState({ smartQuestion: null })
    ui.closeFilter(false)
    data?.clearFilter()
    resetTransactionCursors(ui, data)
    ui.setStatus("Filter cleared")
    return
  }
  if (name === "return" || name === "enter") {
    const draft = (ui.state.filterBar?.draft ?? "")
    // ?<query>: ask the models for a filter; the draft stays open with it.
    if (draft.trimStart().startsWith("?")) {
      if (data) void runSmartSearch(ui, data, draft, () => resetTransactionCursors(ui, data))
      return
    }
    // A smart search's filter, applied as written, keeps saying who wrote it.
    const smart = ui.state.smartQuestion
    const written = smart && smart.expr === draft ? smart.written : undefined
    ui.closeFilter(true)
    const r = data?.commitFilter(draft) ?? { ok: true, err: "" }
    resetTransactionCursors(ui, data)
    const asks = askTerms(data?.state.filterExpr ?? null).length > 0
    if (!draft.trim()) {
      ui.setStatus("Filter cleared")
    } else if (!r.ok) {
      ui.setStatus(`Searching as typed; it can't be saved: ${r.err}`, true)
    } else if (asks) {
      ui.setStatus([written ? writtenText(written) : "", "Jev judging…"].filter(Boolean).join(" · "))
    } else if (data && !data.scopedTransactions().length) {
      // Words that are never on one row together: say how to find either.
      const either = eitherInstead(data.state.filterExpr ? unwrap(data.state.filterExpr) : null, data.accountScoped())
      ui.setStatus(either ? `No row has all of those words · for any of them: ${either}` : "No matches · F1 for search help")
    } else {
      ui.setStatus(searchReport({ written, rows: data?.scopedTransactions().length ?? 0 }))
    }
    if (data && r.ok) void runAsk(ui, data, written)
    return
  }
  const next = editText({ value: (ui.state.filterBar?.draft ?? ""), caret: (ui.state.filterBar?.caret ?? 0) }, key)
  if (next) {
    ui.setState({ filterBar: { draft: next.value, caret: next.caret } })
    // A smart search is plain English until enter asks for its filter.
    if (next.value.trimStart().startsWith("?")) return
    data?.setFilterLive(next.value)
    resetTransactionCursors(ui, data)
  }
}

function handleManagerDetailNotes(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const detail = ui.state.detail
  if (!detail?.notes) return
  const { name } = key
  if (name === "escape") { ui.setState("detail", { notes: null }); ui.setStatus("Notes unchanged"); return }
  if (name === "return" || name === "enter") {
    const asking = data?.updateTransactionNotes(detail.id, detail.notes.draft.trim())
    ui.setStatus("Notes saved")
    if (asking) settleData(ui, asking, (asked) => { if (asked) ui.setStatus("Notes saved · suggestion asked again with them") })
    ui.setState("detail", { notes: null })
    return
  }
  const next = editText({ value: detail.notes.draft, caret: detail.notes.caret }, key)
  if (next) ui.setState("detail", { notes: { draft: next.value, caret: next.caret } })
}

function handleManagerDetail(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key

  if (name === "escape" || name === "return" || name === "enter") { ui.setState({ detail: null }); return }
  if (name === "c") { openCategoryPicker(ui, ui.targetIds(data?.scopedTransactions() ?? []), data); return }
  if (name === "t") { ui.openTagPicker(ui.targetIds(data?.scopedTransactions() ?? [])); return }
  if ((name === "N" || (name === "n" && key.shift)) && data) {
    const row = data.transactions().find((t) => t.id === (ui.state.detail?.id ?? null))
    if (row) { ui.setState({ detail: null }); openMerchantNote(ui, data, row.description) }
    return
  }
  if (name === "n") {
    const notes = data?.transactions().find((t) => t.id === (ui.state.detail?.id ?? null))?.notes ?? ""
    ui.setState("detail", { notes: { draft: notes, caret: notes.length } })
    return
  }
  // J/K scroll what it bought, when that's longer than the view shows.
  if ((name === "j" || name === "k" || name === "J" || name === "K") && (key.shift || name === "J" || name === "K")) {
    const items = data?.transactions().find((t) => t.id === (ui.state.detail?.id ?? null))?.bought?.length ?? 0
    const top = (ui.state.detail?.boughtTop ?? 0) + (name.toLowerCase() === "j" ? 1 : -1)
    ui.setState("detail", { boughtTop: Math.max(0, Math.min(top, items - BOUGHT_LINES)) })
    return
  }
  // j/k browse neighbouring transactions without closing the view.
  if (name === "j" || name === "down" || name === "k" || name === "up") {
    const rows = data?.scopedTransactions() ?? []
    moveTxnCursor(ui, data, name === "j" || name === "down" ? 1 : -1, false)
    const row = rows[ui.state.managerCursor]
    if (row) ui.setState({ detail: { id: row.id, boughtTop: 0, notes: null } })
    return
  }
}

/** Apply a Custom range, from the dialog's fields or its calendar. */
function applyCustomRange(ui: UiStore, start: string, end: string): void {
  const tf: TimeframeState = { ...ui.state.timeframe, family: "custom", custom: { start, end } }
  ui.setTimeframe(tf)
  ui.setState({ customEdit: null })
  ui.setDashChipCursor(CUSTOM_CHIP)
  const read = readCustomRange(start, end, appToday())
  ui.setStatus("error" in read ? "Custom range" : `Custom · ${read.label} · [ ] step by ${read.days} days`)
}

type CustomEdit = NonNullable<UiState["customEdit"]>

/** The calendar's cursor moved (or its view changed): with a first mark
 * waiting, the fields follow the range it would make. */
function moveCustomCursor(ui: UiStore, edit: CustomEdit, cursor: string, view = edit.view): void {
  const range = edit.mark ? markedRange(edit.mark, cursor, view) : null
  ui.setState({ customEdit: { ...edit, cursor, view, error: "", ...(range ? { start: textField(rangeDayText(range.start)), end: textField(rangeDayText(range.end)) } : {}) } })
}

/** A press (enter, space or a click) on the calendar's cell at `cursor`:
 * the first marks it (its whole day, month or year in the fields), the
 * second applies the range from one to the other. */
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

/** The calendar's view (Days, Months, Years), from a key or a click. */
export function setCustomView(ui: UiStore, view: CalendarView): void {
  const edit = ui.state.customEdit
  if (edit) moveCustomCursor(ui, edit, edit.cursor, view)
}

/** ‹ or ›, [ or ]: the calendar a page back or on. */
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
    // A first mark waiting: undone, the fields as they were.
    if (edit.mark && edit.before) { ui.setState({ customEdit: { ...edit, mark: null, before: null, start: textField(edit.before.start), end: textField(edit.before.end) } }); ui.setStatus("Mark undone"); return }
    ui.setState({ customEdit: null }); ui.setStatus("Range unchanged"); return
  }
  const today = appToday()
  const go = (focus: CustomFocus) => ui.setState({ customEdit: { ...edit, focus, error: "", ...(focus === "from" ? { start: textField(edit.start.value) } : focus === "to" ? { end: textField(edit.end.value) } : {}) } })
  // Tab (shift: back) through the stops: the page selector, the views,
  // the grid, From, To.
  if (name === "tab") {
    const at = CUSTOM_FOCUS_ORDER.indexOf(edit.focus)
    go(CUSTOM_FOCUS_ORDER[(at + (key.shift ? -1 : 1) + CUSTOM_FOCUS_ORDER.length) % CUSTOM_FOCUS_ORDER.length]!)
    return
  }
  const left = name === "left", right = name === "right"
  // The page selector: left and right page; down to the grid.
  if (edit.focus === "page") {
    if (left || right) pageCustomCalendar(ui, left ? -1 : 1)
    else if (name === "down") go("grid")
    return
  }
  // The views: left and right switch; down to the grid.
  if (edit.focus === "views") {
    if (left || right) {
      const at = CALENDAR_VIEWS.indexOf(edit.view)
      setCustomView(ui, CALENDAR_VIEWS[Math.max(0, Math.min(CALENDAR_VIEWS.length - 1, at + (left ? -1 : 1)))]!)
    } else if (name === "down") go("grid")
    return
  }
  if (edit.focus === "grid") {
    // Left and right run on across months (the 31st to the 1st); up and
    // down move a row, and off the page's top or bottom row leave the grid
    // for the control on the cursor's side: above, the page selector or
    // the views; below, From or To.
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
  // From and To: typed; up back to the grid; enter applies.
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
  // Typing a date that reads takes the calendar there.
  const day = rangeDayFromText(next.value, today, side)
  ui.setState({ customEdit: { ...edit, [side]: next, error: "", ...(day ? { cursor: day } : {}) } })
}

function handleSettingsFactoryReset(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const dialog = ui.state.factoryReset
  if (!dialog) return
  const opened = ui.opening("factoryReset")
  const { name } = key
  if (name === "escape") { ui.setState({ factoryReset: null }); ui.setStatus("Factory reset cancelled"); return }
  if (name === "return" || name === "enter") {
    if (dialog.busy) return
    if (dialog.draft !== "RESET") { ui.setStatus("Type RESET exactly to erase this database", true); return }
    opened.patch({ busy: true })
    settleData(ui, (async () => {
      try { await data?.factoryResetDatabase(); opened.close(); ui.setStatus("Database reset · OpenTUI settings retained") }
      finally { opened.patch({ busy: false }) }
    })())
    return
  }
  const next = editText({ value: ui.state.factoryReset!.draft, caret: ui.state.factoryReset!.caret }, key)
  if (next) ui.setState("factoryReset", { draft: next.value, caret: next.caret })
}

/** The search help: m switches between the brief and the full version;
 * esc, enter, F1 or q close it; j/k and paging scroll it when the screen
 * is too short for it all. */
function handleSearchHelp(ui: UiStore, key: KeyEvent): void {
  if (["escape", "return", "enter", "f1", "q"].includes(key.name)) { ui.setState({ searchHelp: null }); return }
  if (key.name === "m") { ui.setState("searchHelp", { full: !(ui.state.searchHelp?.full ?? false), top: 0 }); return }
  const top = scrolled(key, (ui.state.searchHelp?.top ?? 0), ((ui.state.searchHelp?.full ?? false) ? SEARCH_HELP_FULL : SEARCH_HELP).length, (ui.state.searchHelp?.visible ?? 0))
  if (top != null) ui.setState("searchHelp", { top })
}

/** A read-only text's first line after a scroll key (j/k a line, paging a
 * screen, g/G the ends), never past its end; null for any other key. */
function scrolled(key: KeyEvent, top: number, total: number, visible: number): number | null {
  const screen = Math.max(1, visible)
  const step = key.name === "j" || key.name === "down" ? 1 : key.name === "k" || key.name === "up" ? -1
    : key.name === "pagedown" || (key.ctrl && key.name === "d") ? screen : key.name === "pageup" || (key.ctrl && key.name === "u") ? -screen
    : key.name === "g" && !key.shift ? -Infinity : key.name === "g" || key.name === "G" ? Infinity : 0
  return step ? Math.max(0, Math.min(Math.max(0, total - screen), top + step)) : null
}

/** Open the note box for a merchant, on its note so far. */
function openMerchantNote(ui: UiStore, data: DataStore, merchant: string): void {
  const draft = data.state.merchantNotes[merchantKey(merchant)] ?? ""
  ui.setState({ merchantNote: { merchant: merchant.trim(), draft, caret: draft.length } })
  ui.setStatus(`Note on ${merchant.trim()} · for suggestions`)
}

/** The note box: enter saves (empty removes) and re-suggests the merchant's
 * waiting rows; esc leaves it as it was. */
function handleMerchantNote(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const box = ui.state.merchantNote
  if (!box) return
  const { name } = key
  if (name === "escape") { ui.setState({ merchantNote: null }); ui.setStatus("Note unchanged"); return }
  if (name === "return" || name === "enter") {
    ui.setState({ merchantNote: null })
    if (!data) return
    const note = box.draft.trim()
    ui.setStatus(`${note ? "Note saved" : "Note removed"} · ${box.merchant}`)
    void data.setMerchantNote(box.merchant, note).then(
      (n) => { if (n) ui.setStatus(`${note ? "Note saved" : "Note removed"} · ${box.merchant} · re-suggested ${count(n, "row")}`) },
      (error) => reportError(ui, error),
    )
    return
  }
  const next = editText({ value: box.draft, caret: box.caret }, key)
  if (next) ui.setState("merchantNote", { draft: next.value, caret: next.caret })
}

function handleManagerAccountAction(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  if (name === "escape") { ui.setState({ accountAction: null }); ui.setStatus("Account actions cancelled"); return }
  const account = data?.state.accounts.find((a) => a.id === (ui.state.accountAction?.id ?? null))
  const moved = listMove(key, (ui.state.accountAction?.cursor ?? 0), ACCOUNT_ACTIONS.length)
  if (moved != null) { ui.setState("accountAction", { cursor: moved }); return }
  if ((name === "return" || name === "enter") && account) {
    const kind = ACCOUNT_ACTIONS[(ui.state.accountAction?.cursor ?? 0)]!
    const opened = ui.opening("accountAction")
    confirmTwice(ui, data, { kind, id: account.id, label: account.name, with: "enter" }, () => opened.close())
  }
}

const confirmations = new WeakMap<UiStore, Set<string>>()

/** del (or enter) twice (state/armed): the first press arms the row, the
 * same key on it again does it; handleKey disarms on any other key.
 * Further confirmation presses do nothing until the write settles. */
function confirmTwice(ui: UiStore, data: DataStore | undefined, armed: Confirm, ok?: (summary: string) => void): void {
  const pending = confirmations.get(ui) ?? new Set<string>()
  const action = `${armed.kind}:${armed.id}`
  if (pending.has(action)) return
  const now = ui.state.armed
  if (now && isArmed(now, armed.kind, armed.id) && now.with === armed.with) {
    ui.disarm()
    pending.add(action)
    confirmations.set(ui, pending)
    settleData(ui, CONFIRMED[armed.kind](data, armed).finally(() => pending.delete(action)), (summary) => { ui.setStatus(summary); ok?.(summary) })
    return
  }
  ui.arm({ ...armed, promptId: ui.setStatus(armedText(armed)) })
}

type Confirm = Omit<Armed, "promptId">

/** What each armed row does on its second press, and the status it leaves. */
const CONFIRMED: Record<Confirm["kind"], (data: DataStore | undefined, c: Confirm) => Promise<string>> = {
  category: async (data, c) => { await data?.deleteSettingsCategory(Number(c.id)); return `Deleted ${c.label}` },
  tag: async (data, c) => { await data?.deleteSettingsTag(Number(c.id)); return `Deleted ${c.label}` },
  rule: async (data, c) => { await data?.deleteSettingsRule(Number(c.id)); return `Deleted ${c.label}` },
  filter: async (data, c) => { await data?.deleteSavedFilter(String(c.id)); return `Deleted ${c.label}` },
  profile: async (data, c) => { await data?.deleteImportProfile(String(c.id)); return `Deleted ${c.label}` },
  budget: async (data, c) => {
    const [key, from] = String(c.id).split("@")
    await data?.removeBudget(scopeOfKey(key!), from)
    return `Deleted ${c.label}`
  },
  clearData: async (data) => { await data?.clearDatabaseData(); return "Transaction and import data cleared" },
  clearAccount: async (data, c) => { await data?.clearAccountData(Number(c.id)); return `Cleared ${c.label}` },
  deleteAccount: async (data, c) => { await data?.removeAccountData(Number(c.id)); return `Removed ${c.label}` },


  desyncAccount: async (data, c) => `Sync off for ${c.label} · ${await data?.setAccountSync(Number(c.id), false) ?? 0} transactions removed`,
  aiKey: async (data, c) => {
    if (!data) return ""
    const row = c.id as NonNullable<UiState["aiDialog"]>["row"]
    if (isLlmRow(row)) {
      const { keyName, modelName } = LLM_PROVIDERS[row]
      await data.saveApiKeys({ [keyName]: null, [modelName]: null, ...(row === "openrouter" ? { JASKMONEY_LLM_MODEL: null } : {}) })
      await signOutLlm(data, row)
    } else await data.saveApiKeys(row === "up" ? { JASKMONEY_UP_TOKEN: null } : row === "jev" ? { JASKMONEY_JEV_TOKEN: null } : { JASKMONEY_CF_TOKEN: null, JASKMONEY_CF_ACCOUNT_ID: null })
    return `Removed what was saved for ${c.label}`
  },
}

function handleSettingsEditor(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  const kind = ui.state.settingsEditor?.kind
  if (!kind) return
  const opened = ui.opening("settingsEditor")
  const id = ui.state.settingsEditor!.id
  if ((name === "return" || name === "enter") && ui.state.settingsEditor!.saving) return
  const draft = ui.state.settingsDraft
  const ctx = { accounts: data?.state.accounts ?? [], categories: data?.state.categories ?? [], tags: data?.state.tags ?? [], savedFilters: data?.state.savedFilters ?? [] }
  const fields = editorFields(kind, draft, ctx)
  const fieldIndex = Math.min(ui.state.settingsEditor!.field, fields.length - 1)
  const field = fields[fieldIndex]!

  // A picker field's list owns input until it closes (like the category
  // picker: arrows move, printable keys filter).
  const picker = ui.state.settingsEditor!.picker
  if (picker) {
    const choices = pickerChoices(pickerItems(kind, field.key, ctx, picker.query))
    queryPickerKey(key, picker, choices.length, {
      close: () => ui.setState("settingsEditor", { picker: null }),
      update: (next) => ui.setState("settingsEditor", { picker: next }),
      apply: () => {
        const choice = choices[picker.cursor]
        if (!choice) return
        if (field.multi) {
          // Multi-choice (a rule's tags, a tag's categories): enter toggles; esc closes.
          const id = Number(choice.value)
          const multiKey = field.key as "addTagIds" | "categoryIds"
          const ids = draft[multiKey]
          ui.setState("settingsDraft", multiKey, ids.includes(id) ? ids.filter((t) => t !== id) : [...ids, id])
          return
        }
        ui.setState("settingsDraft", field.key as "scopeKey", choice.value as never)
        ui.setState("settingsEditor", { picker: null })
      },
    })
    return
  }

  const isText = field.kind === "text"
  const move = (step: number) => {
    const next = (fieldIndex + step + fields.length) % fields.length
    const field = fields[next]!
    ui.setState("settingsEditor", { field: next, caret: field.kind === "text" ? field.display.length : 0 })
  }
  if (name === "escape") { ui.closeSettingsEditor(); ui.setStatus("Edit cancelled"); return }
  if (name === "tab") { move(key.shift ? -1 : 1); return }
  if (name === "down" || (!isText && name === "j")) { move(1); return }
  if (name === "up" || (!isText && name === "k")) { move(-1); return }
  if ((name === "return" || name === "enter") && field.kind === "picker") {
    // Open the list on the current value.
    const current = draft[field.key]
    const at = field.multi ? 0 : pickerChoices(pickerItems(kind, field.key, ctx, "")).findIndex((c) => c.value === current)
    ui.setState("settingsEditor", { picker: { query: "", cursor: Math.max(0, at) } })
    return
  }
  if (name === "return" || name === "enter") {
    // One save at a time: over a socket the editor stays open until the
    // core answers, and a second enter would create the record twice.
    opened.patch({ saving: true })
    settleData(ui, (async () => {
      try {
        if (kind === "category") {
          if (id == null) await data?.createSettingsCategory({ name: draft.name, color: draft.color, notSpending: draft.notSpending })
          else await data?.updateSettingsCategory(Number(id), { name: draft.name, color: draft.color, notSpending: draft.notSpending })
        } else if (kind === "tag") {
          const tag = { name: draft.name, color: draft.color, categoryIds: draft.categoryIds, about: draft.about.trim() || null }
          if (id == null) await data?.createSettingsTag(tag)
          else await data?.updateSettingsTag(Number(id), tag)
        } else if (kind === "budget") {
          const option = budgetScopeOptions(ctx.accounts, ctx.categories).find((o) => o.key === draft.scopeKey)
          const amount = amountFromText(draft.amount)
          if (!option) throw new Error("choose what the budget covers")
          if (amount === null) throw new Error("enter the budget amount")
          const cycle = cycleFromDraft(draft)
          if (typeof cycle === "string") throw new Error(cycle)
          const current = data?.state.budgetCycle
          // The cycle is shared by every budget; save it first so a bad date
          // stops the whole edit.
          if (current && (current.unit !== cycle.unit || current.anchor !== cycle.anchor || current.anchorDate !== cycle.anchorDate || !!current.payEarly !== !!cycle.payEarly)) await data?.setBudgetCycle(cycle)
          // From the cycle the Budgets tab shows (this one elsewhere).
          const view = data ? viewedBudgets(ui, data) : undefined
          const editing = view?.budgets.find((b) => b.id === id)
          // A new scope ends the old budget in the same write.
          await data?.setBudget(option.scope, amount, view?.cycle.start, editing?.scope)
        } else if (kind === "cycle") {
          const cycle = cycleFromDraft(draft)
          if (typeof cycle === "string") throw new Error(cycle)
          await data?.setBudgetCycle(cycle)
        } else if (kind === "filter") {
          await data?.saveSavedFilter({ id: draft.id, name: draft.name, expr: draft.expr }, typeof id === "string" ? id : undefined)
        } else {
          const existing = data?.state.rules.find((r) => r.id === id)
          const rule = { id: Number(id ?? 0), name: draft.name, savedFilterId: draft.savedFilterId, setCategoryId: draft.setCategoryId, addTagIds: draft.addTagIds, enabled: existing?.enabled ?? true, sortOrder: existing?.sortOrder ?? 0 }
          if (id == null) await data?.createSettingsRule(rule)
          else await data?.updateSettingsRule(rule)
        }
        opened.close(); ui.setStatus("Saved")
      } finally { opened.patch({ saving: false }) }
    })())
    return
  }
  const left = name === "left" || (!isText && name === "h")
  const right = name === "right" || (!isText && (name === "l" || name === "space"))
  if ((left || right) && field.kind === "choice" && field.choices) {
    const previousUnit = draft.unit
    ui.setState("settingsDraft", field.key as "unit", stepChoice(field.choices, draft[field.key] as string, left ? -1 : 1) as never)
    // A new unit or start asks for the start in its own form.
    if (field.key === "unit" || field.key === "anchor") ui.setState("settingsDraft", normaliseCycleDraft(ui.state.settingsDraft, previousUnit))
    return
  }
  if ((left || right) && field.kind === "toggle") {
    ui.setState("settingsDraft", field.key as "notSpending", !draft[field.key])
    return
  }
  if (isText) {
    const next = editText({ value: field.display, caret: ui.state.settingsEditor!.caret }, key)
    if (next) {
      ui.setState("settingsDraft", field.key as "name", next.value)
      ui.setState("settingsEditor", { caret: next.caret })
    }
  }
}

function handleSettingsImportFiles(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const wizard = ui.state.importWizard
  if (!wizard) return
  const opened = ui.opening("importWizard")
  const stage = wizard.stage
  const current = () => opened.open && ui.state.importWizard?.stage === stage
  const { name } = key
  const files = wizard.files
  if (name === "escape") { ui.cancelImport(); ui.setStatus("Import cancelled"); return }
  const moved = listMove(key, wizard.cursor, files.length)
  if (moved != null) { opened.patch({ cursor: moved }); return }
  if (name === "/" || name === "p") { opened.patch({ stage: "path", path: "", pathCaret: 0 }); return }
  if ((name === "return" || name === "enter") && files[wizard.cursor]) {
    const path = files[wizard.cursor]!
    const matches = data?.profileMatches(path) ?? []
    if (matches.length === 1) { settleData(ui, (async () => { const preview = await data?.previewImport(path, matches[0]!); if (current()) opened.patch({ stage: "preview", path, pathCaret: path.length, preview: preview ?? null }) })()) }
    else opened.patch({ stage: "profile", path, pathCaret: path.length, profileCursor: 0 })
    return
  }
}

function handleSettingsImportPath(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const wizard = ui.state.importWizard
  if (!wizard) return
  const opened = ui.opening("importWizard")
  const stage = wizard.stage
  const current = () => opened.open && ui.state.importWizard?.stage === stage
  const { name } = key
  if (name === "escape") { opened.patch({ stage: "files", path: "", pathCaret: 0 }); return }
  if (name === "return" || name === "enter") {
    const raw = wizard.path.trim()
    if (!raw) { ui.setStatus("Enter a CSV path", true); return }
    const path = resolve(wizard.directory, raw)
    settleData(ui, (async () => {
      const matches = data?.profileMatches(path) ?? []
      if (matches.length === 1) {
        const preview = await data?.previewImport(path, matches[0]!) ?? null
        if (current()) opened.patch({ stage: "preview", path, pathCaret: path.length, preview })
      }
      else opened.patch({ stage: "profile", path, pathCaret: path.length, profileCursor: 0 })
    })())
    return
  }
  const next = editText({ value: wizard.path, caret: wizard.pathCaret }, key)
  if (next) opened.patch({ path: next.value, pathCaret: next.caret })
}

function handleSettingsImportProfile(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const wizard = ui.state.importWizard
  if (!wizard) return
  const opened = ui.opening("importWizard")
  const stage = wizard.stage
  const current = () => opened.open && ui.state.importWizard?.stage === stage
  const { name } = key
  const profiles = data?.state.importProfiles ?? []
  if (name === "escape") { if (wizard.managing) opened.close(); else opened.patch({ stage: "files", managing: false }); return }
  const moved = listMove(key, wizard.profileCursor, profiles.length + 1)
  if (moved != null) { opened.patch({ profileCursor: moved }); return }
  if (name === "a" || name === "n" || (name === "return" || name === "enter") && wizard.profileCursor === profiles.length) { ui.openProfileEditor(defaultProfile(nextSettingsId("profile", profiles), wizard.path), null); return }
  if (name === "e" && profiles[wizard.profileCursor]) { ui.openProfileEditor(profiles[wizard.profileCursor]!, profiles[wizard.profileCursor]!.id); return }
  if (name === "delete" && profiles[wizard.profileCursor]) { const selected = profiles[wizard.profileCursor]!; confirmTwice(ui, data, { kind: "profile", id: selected.id, label: selected.name, with: "delete" }); return }
  if ((name === "return" || name === "enter") && profiles[wizard.profileCursor]) {
    if (wizard.managing) { ui.openProfileEditor(profiles[wizard.profileCursor]!, profiles[wizard.profileCursor]!.id); return }
    settleData(ui, (async () => {
      const preview = await data?.previewImport(wizard.path, profiles[wizard.profileCursor]!) ?? null
      if (current()) opened.patch({ stage: "preview", preview })
    })())
    return
  }
}

function handleSettingsImportProfileEditor(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const wizard = ui.state.importWizard
  if (!wizard) return
  const opened = ui.opening("importWizard")
  const stage = wizard.stage
  const current = () => opened.open && ui.state.importWizard?.stage === stage
  const { name } = key
  const draft = wizard.profileDraft, field = wizard.profileField
  const fields = ["id", "name", "account", "accountType", "importPrefix", "hasHeader", "delimiter", "dateColumn", "amountColumn", "descriptionColumns", "descriptionJoin", "amountStrip", "dateFormat"] as const
  const selected = fields[field]!
  if (name === "escape") { opened.patch({ stage: "profile" }); return }
  if (name === "tab") {
    const next = (field + (key.shift ? -1 : 1) + fields.length) % fields.length
    const selected = fields[next]!
    const value = selected === "descriptionColumns" ? draft.descriptionColumns.join(",") : String(draft[selected])
    opened.patch({ profileField: next, profileCaret: value.length })
    return
  }
  if (name === "return" || name === "enter") {
    settleData(ui, (async () => {
      const { path, profileEditId } = wizard
      await data?.saveImportProfile(draft, profileEditId)
      if (!current()) return
      const preview = path ? await data?.previewImport(path, draft) : null
      if (!current()) return
      opened.patch({ stage: preview ? "preview" : "profile", preview: preview ?? null, profileEditId: null })
      ui.setStatus(`Saved profile ${draft.name}`)
    })())
    return
  }
  if (selected === "accountType" && (name === "h" || name === "left" || name === "l" || name === "right" || name === "space")) { ui.setState("importWizard", "profileDraft", "accountType", draft.accountType === "debit" ? "credit" : "debit"); return }
  if ((selected === "hasHeader" || selected === "descriptionJoin") && (name === "h" || name === "left" || name === "l" || name === "right" || name === "space")) { ui.setState("importWizard", "profileDraft", selected, !draft[selected]); return }
  if (selected === "dateFormat" && (name === "h" || name === "left" || name === "l" || name === "right" || name === "space")) { const values = ["DMY", "MDY", "YMD"] as const; ui.setState("importWizard", "profileDraft", "dateFormat", values[(values.indexOf(draft.dateFormat) + 1) % values.length]!); return }
  if (selected === "accountType" || selected === "hasHeader" || selected === "descriptionJoin" || selected === "dateFormat") return
  const text = selected === "descriptionColumns" ? draft.descriptionColumns.join(",") : String(draft[selected])
  const next = editText({ value: text, caret: wizard.profileCaret }, key)
  if (next) {
    opened.patch({ profileCaret: next.caret })
    if (selected === "descriptionColumns") ui.setState("importWizard", "profileDraft", selected, next.value ? next.value.split(",").map(Number).filter(Number.isInteger) : [])
    else if (selected === "dateColumn" || selected === "amountColumn") ui.setState("importWizard", "profileDraft", selected, Number(next.value || 0))
    else ui.setState("importWizard", "profileDraft", selected, next.value)
  }
}

function handleSettingsImportPreview(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const wizard = ui.state.importWizard
  if (!wizard) return
  const opened = ui.opening("importWizard")
  const { name } = key
  if (wizard.committing && ["s", "a", "r", "p", "escape"].includes(key.name)) return
  const preview = wizard.preview
  const rows = preview ? (wizard.previewShowAll ? preview.rows : preview.rows.filter((row) => row.duplicate)) : []
  if (name === "escape") { ui.cancelImport(); ui.setStatus("Import cancelled"); return }
  const moved = listMove(key, wizard.previewCursor, rows.length)
  if (moved != null) { opened.patch({ previewCursor: moved }); return }
  if (name === "p") { opened.patch({ previewShowAll: !wizard.previewShowAll, previewCursor: 0 }); return }
  if (name === "r") { opened.patch({ previewRules: !wizard.previewRules }); return }
  if ((name === "s" || name === "a") && preview) {
    opened.patch({ committing: true })
    const rulesEnabled = wizard.previewRules
    settleData(ui, (async () => {
      let summary: string
      try {
        summary = await data?.commitPreview({ ...preview, rulesEnabled }, name === "s") ?? "Import unavailable"
      } catch (error) { opened.patch({ committing: false }); throw error }
      opened.close()
      ui.setStatus(summary)
      // The new rows get suggestions in the background.
      if (data) settleData(ui, suggestNew(data), (n) => { if (n) ui.setStatus(summary + newSuggestionsNote(n)) })
    })())
    return
  }
}

function handleSettings(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  if (name === "i") {
    const from = ui.activeScope()
    settleData(ui, (async () => {
      const directory = await data?.importDirectory() ?? process.cwd()
      const files = await data?.csvFiles(directory) ?? []
      if (ui.activeScope() !== from) return
      ui.activateSettings("database")
      ui.beginImport(directory, files)
    })())
    return
  }
  // One stop per pane: Saved filters shares Rules' pane, and its stop.
  const sections = SETTINGS_SECTIONS
  const current = ui.state.settingsSection === "filters" ? "rules" : ui.state.settingsSection
  const go = (next: SettingsSection) => ui.setState({ settingsSection: next, taxonomyList: "categories", focusedSection: settingsSectionFocus(next) })
  // h/l: the pane beside it on screen (panes sit side by side within a
  // column too); before the panes are drawn, the other column's first.
  if (name === "h" || name === "left" || name === "l" || name === "right") {
    const left = name === "h" || name === "left"
    const regions = regionRects("settings")
    const from = regions.find((region) => region.id === settingsSectionFocus(current))
    if (!from) { if (left ? SETTINGS_RIGHT.includes(current) : !SETTINGS_RIGHT.includes(current)) go(left ? "taxonomy" : "up"); return }
    const next = nearestRegion(from.rect, regions.filter((region) => region !== from), left ? "left" : "right")
    const section = SETTINGS_SECTIONS.find((section) => settingsSectionFocus(section) === next)
    if (section) go(section)
    return
  }
  if (name === "j" || name === "down" || name === "k" || name === "up") {
    const delta = name === "j" || name === "down" ? 1 : -1
    go(sections[(sections.indexOf(current) + delta + sections.length) % sections.length]!)
    return
  }
  if (name === "return" || name === "enter") { ui.activateSettings(current); return }
}

/** Two lists stacked in one pane (Categories over Tags, Rules over Saved
 * filters), moved through as one: j off the end of the first lands on the
 * second. An empty list still takes a stop, where a adds to it. */
function stackedMove(key: KeyEvent, first: { cursor: number; count: number }, second: { cursor: number; count: number }, onFirst: boolean, page = PAGE): { first: boolean; cursor: number } | null {
  const a = Math.max(1, first.count), b = Math.max(1, second.count)
  const at = onFirst ? Math.min(first.cursor, a - 1) : a + Math.min(second.cursor, b - 1)
  const moved = listMove(key, at, a + b, page)
  if (moved == null || moved === at) return moved == null ? null : { first: onFirst, cursor: onFirst ? at : at - a }
  return moved < a ? { first: true, cursor: moved } : { first: false, cursor: moved - a }
}

/** Taxonomy's category groups: open or closed (one row with its count). */
function setGroupOpen(ui: UiStore, id: number, open: boolean): void {
  const ids = ui.state.taxonomyOpen.filter((other) => other !== id)
  ui.setState({ taxonomyOpen: open ? [...ids, id] : ids })
}

function handleSettingsTaxonomy(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  const list = ui.state.taxonomyList
  const rows = categoryRows(data?.state.categories ?? [], ui.state.taxonomyOpen)
  const tags = data?.state.tags ?? []
  if (name === "escape") { ui.leaveSettings(); return }
  const moved = stackedMove(key, { cursor: ui.state.categoryCursor, count: rows.length }, { cursor: ui.state.tagCursor, count: tags.length }, list === "categories", ui.state.taxonomyVisible)
  if (moved) {
    ui.setState(moved.first ? { taxonomyList: "categories", focusedSection: "set.categories", categoryCursor: moved.cursor } : { taxonomyList: "tags", focusedSection: "set.tags", tagCursor: moved.cursor })
    return
  }
  const row = list === "categories" ? rows[Math.min(ui.state.categoryCursor, rows.length - 1)] : undefined
  const item = list === "categories" ? row?.category : tags[Math.min(ui.state.tagCursor, tags.length - 1)]
  // A group opens and closes on space or enter, l and h; h on a
  // subcategory closes its group, the cursor back on the group.
  if (row && row.children && (name === "space" || name === "return" || name === "enter")) { setGroupOpen(ui, row.category.id, !row.open); return }
  if (row && row.children && (name === "l" || name === "right")) { setGroupOpen(ui, row.category.id, true); return }
  if (row && (name === "h" || name === "left")) {
    if (row.children) { setGroupOpen(ui, row.category.id, false); return }
    if (row.depth === 1) {
      const group = rows.findIndex((r) => r.category.id === row.category.parentId)
      setGroupOpen(ui, row.category.parentId!, false)
      ui.setState({ categoryCursor: Math.max(0, group) })
    }
    return
  }
  if (name === "a") {
    ui.openSettingsEditor(list === "categories" ? "category" : "tag", null, { ...ui.state.settingsDraft, name: "", color: list === "categories" ? "#94e2d5" : "#89b4fa", categoryIds: [], about: "", notSpending: false })
    return
  }
  if ((name === "e" || name === "return" || name === "enter") && item) {
    ui.openSettingsEditor(list === "categories" ? "category" : "tag", item.id, { ...ui.state.settingsDraft, name: item.name, color: item.color, categoryIds: "categoryIds" in item ? [...item.categoryIds] : [], about: "about" in item ? item.about ?? "" : "", notSpending: "notSpending" in item ? item.notSpending : false })
    return
  }
  if (name === "delete" && item) { confirmTwice(ui, data, { kind: list === "categories" ? "category" : "tag", id: item.id, label: item.name, with: "delete" }); return }
}

function handleSettingsRules(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  const rules = data?.state.rules ?? []; const cursor = ui.state.ruleCursor; const rule = rules[cursor]
  if (name === "escape") { ui.leaveSettings(); return }
  if (shifted(key, "j") && rule) { settleData(ui, (async () => { await data?.reorderSettingsRule(rule.id, cursor + 1); ui.setState({ ruleCursor: Math.min(rules.length - 1, cursor + 1) }) })()); return }
  if (shifted(key, "k") && rule) { settleData(ui, (async () => { await data?.reorderSettingsRule(rule.id, cursor - 1); ui.setState({ ruleCursor: Math.max(0, cursor - 1) }) })()); return }
  if (shifted(key, "a") && data) { applyAllRules(ui, data); return }
  if (shifted(key, "d") && data) { showDryRun(ui, data); return }
  const moved = stackedMove(key, { cursor: cursor, count: rules.length }, { cursor: ui.state.filterCursor, count: data?.state.savedFilters.length ?? 0 }, true)
  if (moved) { ui.setState(moved.first ? { ruleCursor: moved.cursor } : { settingsSection: "filters", focusedSection: "set.filters", filterCursor: moved.cursor }); return }
  if (name === "a") { ui.openSettingsEditor("rule", null, { ...ui.state.settingsDraft, name: "", savedFilterId: data?.state.savedFilters[0]?.id ?? "", setCategoryId: null, addTagIds: [] }); return }
  if ((name === "return" || name === "enter") && rule) { ui.openSettingsEditor("rule", rule.id, { ...ui.state.settingsDraft, name: rule.name, savedFilterId: rule.savedFilterId, setCategoryId: rule.setCategoryId, addTagIds: rule.addTagIds }); return }
  if (name === "space" && rule) { settleData(ui, (async () => { await data?.toggleSettingsRule(rule.id, !rule.enabled) })()); return }
  if (name === "delete" && rule) { confirmTwice(ui, data, { kind: "rule", id: rule.id, label: rule.name, with: "delete" }); return }
}

function handleSettingsFilters(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  const filters = data?.state.savedFilters ?? []; const cursor = ui.state.filterCursor; const filter = filters[cursor]
  if (name === "escape") { ui.leaveSettings(); return }
  const moved = stackedMove(key, { cursor: ui.state.ruleCursor, count: data?.state.rules.length ?? 0 }, { cursor: cursor, count: filters.length }, false)
  if (moved) { ui.setState(moved.first ? { settingsSection: "rules", focusedSection: "set.rules", ruleCursor: moved.cursor } : { filterCursor: moved.cursor }); return }
  if (name === "a") { const id = nextSavedFilterId(filters); ui.openSettingsEditor("filter", null, { ...ui.state.settingsDraft, id, name: "", expr: "" }); return }
  if ((name === "return" || name === "enter") && filter) { ui.openSettingsEditor("filter", filter.id, { ...ui.state.settingsDraft, id: filter.id, name: filter.name, expr: filter.expr }); return }
  if (name === "delete" && filter) { confirmTwice(ui, data, { kind: "filter", id: filter.id, label: filter.name, with: "delete" }); return }
}

/** Settings › Up Bank's rows: the token (enter opens its dialog), sync
 * (enter syncs now) and the accounts (enter opens which ones sync). */
export const UP_ROWS = ["token", "sync", "accounts", "setup"] as const

function handleSettingsUp(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  if (name === "escape") { ui.leaveSettings(); return }
  const moved = listMove(key, ui.state.upCursor, UP_ROWS.length)
  if (moved != null) { ui.setState({ upCursor: moved }); return }
  if (name === "return" || name === "enter") {
    const row = UP_ROWS[Math.min(ui.state.upCursor, UP_ROWS.length - 1)]
    if (row === "token") openAiDialog(ui, "up")
    else if (row === "sync" && data) void runSync(ui, data, { manual: true })
    else if (row === "accounts") ui.setState({ upAccounts: { cursor: 0 } })
    else if (row === "setup") openWelcome(ui)
    return
  }
  if (name === "s" && data) { void runSync(ui, data, { manual: true }); return }
}

/** Settings › Web app: enter opens the page this core serves. */
function handleSettingsWeb(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  if (name === "escape") { ui.leaveSettings(); return }
  if (name === "return" || name === "enter" || name === "o") {
    if (web.serving()) openBarItem(ui, data, "bar.web")
    else ui.setStatus("Not serving the web app · start with --serve")
  }
}

/** Database & Import › Import history: every import, newest first. */
function handleImportHistory(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  if (key.name === "escape") { ui.setState({ importHistory: null }); return }
  const count = data?.state.imports.length ?? 0
  const moved = listMove(key, ui.state.importHistory?.top ?? 0, Math.max(1, count - IMPORT_HISTORY_ROWS + 1), IMPORT_HISTORY_ROWS)
  if (moved != null) ui.setState("importHistory", { top: moved })
}

/** The accounts dialog: one row per Up account; enter switches sync on at
 * once, and off on a second enter (it removes the account's rows). */
function handleUpAccounts(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const dialog = ui.state.upAccounts
  if (!dialog) return
  const { name } = key
  const accounts = data?.state.syncAccounts ?? []
  if (name === "escape") { ui.disarm(); ui.setState({ upAccounts: null }); return }
  const moved = listMove(key, dialog.cursor, accounts.length)
  if (moved != null) { ui.setState("upAccounts", { cursor: moved }); return }
  const account = accounts[dialog.cursor]
  if ((name === "return" || name === "enter") && account && data) {
    // Switching off deletes the account's transactions: enter twice.
    if (account.syncEnabled) { confirmTwice(ui, data, { kind: "desyncAccount", id: account.id, label: account.name, with: "enter" }); return }
    settleData(ui, (async () => { await data.setAccountSync(account.id, true); ui.setStatus(`Sync on for ${account.name} · s to sync now`) })())
    return
  }
  if (name === "s" && data) { void runSync(ui, data, { manual: true }); return }
}

/** AI models: one row per provider; enter edits its key, t tests it, del
 * removes the saved one (the environment's, if any, then applies). */
/** `?` (some terminals send it as shift+/). */
function isSmartSearchKey(key: KeyEvent): boolean {
  return key.sequence === "?" || key.name === "?" || (key.name === "/" && key.shift)
}

/** Open the filter as a smart search: `?` and a question. On a filter a
 * smart search wrote, its question comes back to reword. */
function openSmartSearch(ui: UiStore, data?: DataStore): void {
  const question = smartQuestionFor(ui.state, data?.state.filterQuery ?? "")
  ui.openFilter(`?${question ?? ""}`)
  ui.setStatus(question ? "Reword the question · enter asks again · esc clears" : "Smart search · ask in words · enter asks · esc clears")
}

/** Accept-all's preview: enter (or y) accepts those rows, esc doesn't. */
function handleManagerAcceptPreview(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  const ids = ui.state.acceptPreview ?? []
  if (name === "escape") { ui.setState({ acceptPreview: null }); ui.setStatus("Nothing accepted"); return }
  if ((name === "return" || name === "enter" || name === "y") && data) {
    ui.setState({ acceptPreview: null })
    // The same preview serves a tag review and the Uncategorised view.
    void (data.state.tagReview ? runTagAccept(ui, data, ids) : runAccept(ui, data, ids))
  }
}

/** R: rules offered from repeated categorisations. enter makes the cursor's,
 * x declines it for good, esc closes (offers stay). */
function handleRuleOffers(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const dialog = ui.state.ruleOffers
  if (!dialog) return
  const opened = ui.opening("ruleOffers")
  const { name } = key
  const offers = data?.allRuleOffers() ?? []
  const close = () => opened.close()
  if (name === "escape") { close(); ui.setStatus("Transactions"); return }
  if (dialog.busy && ["return", "enter", "x"].includes(name)) return
  // The final action row asks the general model for more rules.
  if ((name === "return" || name === "enter") && dialog.cursor === offers.length && !!data?.state.llm && data) {
    askForRules(ui, data)
    return
  }
  const moved = listMove(key, dialog.cursor, offers.length + (!!data?.state.llm ? 1 : 0))
  if (moved != null) { ui.setState("ruleOffers", { cursor: moved }); return }
  const offer = offers[dialog.cursor]
  if (!offer || !data) return
  const settle = () => {
    if (!opened.open) return
    const left = data.allRuleOffers().length + (!!data?.state.llm ? 1 : 0)
    if (!left) close()
    else opened.patch({ cursor: Math.min(dialog.cursor, left - 1), busy: false })
  }
  if (name === "return" || name === "enter") {
    ui.setStatus(`Making a rule for ${offer.description}…`)
    opened.patch({ busy: true })
    data.makeOfferedRule(offer).then(
      (summary) => { settle(); ui.jumpManagerCursor(Math.min(ui.state.managerCursor, Math.max(0, data.scopedTransactions().length - 1)), data.scopedTransactions().length); ui.setStatus(summary) },
      (e) => { opened.patch({ busy: false }); reportError(ui, e) },
    )
    return
  }
  if (name === "x" && !key.shift) {
    opened.patch({ busy: true })
    settleData(ui, (async () => {
      try {
        await data.declineRuleOffer(offer)
        settle()
        ui.setStatus(`No rule for ${offer.description}; it won't be offered again`)
      } finally { opened.patch({ busy: false }) }
    })())
  }
}

/** Settings › AI models: the models, the uses, then the sources; enter opens the one at the cursor. */
function handleSettingsAi(ui: UiStore, key: KeyEvent): void {
  const { name } = key
  if (name === "escape") { ui.leaveSettings(); return }
  // Models, then sources (Executor: Gmail and your other accounts), then uses.
  const rows = aiPaneRows(AI_ROWS)
  const moved = listMove(key, ui.state.aiCursor, rows.length)
  if (moved != null) { ui.setState({ aiCursor: moved }); return }
  if (name !== "return" && name !== "enter") return
  const row = rows[Math.min(ui.state.aiCursor, rows.length - 1)]!
  if (row.kind === "source") settleData(ui, openExecutorDialog(ui))
  else if (row.kind === "use") ui.setState({ aiUse: { use: row.use, cursor: 0, note: null } })
  else openAiDialog(ui, row.row)
}

const openAiDialog = (ui: UiStore, row: NonNullable<UiState["aiDialog"]>["row"]) => ui.setState({ aiDialog: aiDialogFor(row) })

/** A use's dialog: j/k move over its queries, then its model actions;
 * enter opens a query (what it asks, its context, the exact request) or
 * runs the action: choose the model, connect one it needs; esc closes. */
function handleAiUse(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const dialog = ui.state.aiUse
  if (!dialog || !data) return
  const { name } = key
  if (name === "escape") { ui.setState({ aiUse: null }); return }
  const queries = useQueries(dialog.use)
  const actions = useActions(dialog.use, aiContext(data))
  const moved = listMove(key, dialog.cursor, queries.length + actions.length)
  if (moved != null) { ui.setState("aiUse", { cursor: moved }); return }
  if (name !== "return" && name !== "enter") return
  const query = queries[dialog.cursor]
  if (query) { void openQuery(ui, data, dialog.use, query); return }
  const action = actions[dialog.cursor - queries.length]
  if (!action) return
  const opened = ui.opening("aiUse")
  const note = (text: string) => opened.patch({ note: { text, ok: true } })
  switch (action.id) {
    case "clairic":
      settleData(ui, data.saveApiKeys({ JASKMONEY_SEARCH_CLAIRIC: action.on ? null : "off" }), () => note(action.on ? "Smart search asks Clairic for the words and dates" : "Smart search asks Jev alone"))
      return
    case "provider":
      settleData(ui, data.saveApiKeys({ JASKMONEY_LLM_PROVIDER: action.provider }), () => note(`${LLM_PROVIDERS[action.provider].label} now writes rules`))
      return
    case "model":
      openModelPicker(ui, action.provider)
      return
    case "connect":
      ui.setState({ aiUse: null, aiCursor: AI_ROWS.indexOf(action.row) })
      openAiDialog(ui, action.row)
  }
}

/** Show a query, and build its exact request (nothing is sent). */
async function openQuery(ui: UiStore, data: DataStore, use: AiUse, query: QueryId): Promise<void> {
  ui.setState({ aiSent: { use, query, part: null, error: null, top: 0, visible: 0, lines: 0 } })
  const opened = ui.opening("aiSent")
  const current = () => opened.open && ui.state.aiSent?.query === query
  try {
    const askWords = askTerms(data.state.filterExpr)[0]
    const parts = await previewSent(use, data, { smartQuestion: ui.state.smartQuestion?.question, ...(askWords ? { askWords } : {}), clairic: aiContext(data).searchClairic && hasWorkersAi() })
    const part = parts.find((p) => p.query === query)
    if (current()) opened.patch(part ? { part } : { error: "Nothing to build it for yet: it needs rows of the kind it asks about." })
  } catch (error) {
    if (current()) opened.patch({ error: error instanceof Error ? error.message : String(error) })
  }
}

/** A query's view: it scrolls; esc goes back to the use. */
function handleAiSent(ui: UiStore, key: KeyEvent): void {
  const view = ui.state.aiSent
  if (!view) return
  if (key.name === "escape" || key.name === "q") { ui.setState({ aiSent: null }); return }
  const top = scrolled(key, view.top, view.lines, view.visible)
  if (top != null) ui.setState("aiSent", { top })
}

/** The AI models dialog: j/k pick an action, enter runs it; a field (key,
 * account id, model) takes typing and pasting until enter saves or esc
 * backs out; remove needs enter twice; esc closes. */
/** Executor's dialog (app/executorSource): j/k over the actions, enter runs
 * one; esc cancels a browser sign-in in progress and closes. */
function handleExecutor(ui: UiStore, key: KeyEvent): void {
  const dialog = ui.state.executor
  if (!dialog) return
  if (key.name === "escape") { cancelExecutorSignIn(); ui.setState({ executor: null }); return }
  if (dialog.waiting) return
  const moved = listMove(key, dialog.cursor, executorActions(dialog.status).length)
  if (moved != null) { ui.setState("executor", { cursor: moved }); return }
  if (key.name === "return" || key.name === "enter") settleData(ui, runExecutorAction(ui))
}

function handleAiDialog(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const dialog = ui.state.aiDialog
  if (!dialog || !data) return
  const { name } = key
  const row = dialog.row
  // Work that finishes after the dialog closed writes nothing (Opening).
  const opened = ui.opening("aiDialog")
  const note = (text: string, ok: boolean | null) => opened.patch({ note: { text, ok }, busy: false })
  if (dialog.field) {
    if (dialog.busy && name !== "escape") return
    const field = dialog.field
    if (name === "escape") { opened.patch({ field: null }); return }
    if (name === "return" || name === "enter") {
      const value = field.value.trim()
      opened.patch({ busy: true })
      settleData(ui, (async () => {
        try {
          if (field.action === "key") {
            if (!value) { opened.patch({ field: null }); return }
            await data.saveApiKeys(row === "up" ? { JASKMONEY_UP_TOKEN: value } : row === "jev" ? { JASKMONEY_JEV_TOKEN: value } : row === "workersAi" ? { JASKMONEY_CF_TOKEN: value } : { [LLM_PROVIDERS[row].keyName]: value })
            // Clairic's account comes from its token: nobody has to find the ID.
            if (row === "workersAi") {
              const found = await data.findCloudflareAccount().catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }))
              opened.patch({ field: null, note: "name" in found ? { text: `Token saved · account: ${found.name}`, ok: true }
                : "count" in found ? { text: `Token saved · it reaches ${found.count} accounts: enter the account ID`, ok: null }
                : { text: `Token saved, but Cloudflare didn't list its account (${found.error}): enter the account ID`, ok: false } })
              return
            }
            opened.patch({ field: null, note: { text: row === "up" ? "Token saved · Test checks it; s in Up Bank syncs" : "Key saved", ok: true } })
          } else if (field.action === "accountId") {
            await data.saveApiKeys({ JASKMONEY_CF_ACCOUNT_ID: value || null })
            opened.patch({ field: null, note: { text: value ? "Account ID saved" : "Account ID removed", ok: true } })
          } else if (isLlmRow(row)) {
            const { modelName, defaultModel } = LLM_PROVIDERS[row]
            // An id the provider doesn't have is refused; the default isn't saved, so it follows the app's.
            createLlm({ provider: row, apiKey: "x", modelId: value || defaultModel })
            await data.saveApiKeys({ [modelName]: value && value !== defaultModel ? value : null, ...(row === "openrouter" ? { JASKMONEY_LLM_MODEL: null } : {}) })
            opened.patch({ field: null, note: { text: `Model: ${value || defaultModel}`, ok: true } })
          }
        } catch (e) {
          note(e instanceof Error ? e.message : String(e), false)
        } finally { opened.patch({ busy: false }) }
      })())
      return
    }
    // A key is never shown, so edits apply at its end.
    const next = editText({ value: field.value, caret: field.action === "key" ? field.value.length : field.caret }, key)
    if (next) ui.setState("aiDialog", "field", { value: next.value, caret: next.caret })
    return
  }
  const ctx = aiContext(data)
  const actions = aiActions(row, ctx)
  if (name === "escape") { opened.close(); return }
  const moved = listMove(key, dialog.cursor, actions.length)
  if (moved != null) { opened.patch({ cursor: moved }); return }
  if (name !== "return" && name !== "enter") return
  const action = actions[Math.min(dialog.cursor, actions.length - 1)]
  if (!action || dialog.busy) return
  switch (action.id) {
    case "signIn":
      if (isLlmRow(row)) settleData(ui, startLlmSignIn(ui, data, row), (result) => { if (result) note(result.text, result.ok) })
      return
    case "model":
      // A list of the provider's models, not a slug to type.
      if (isLlmRow(row)) openModelPicker(ui, row)
      return
    case "key":
    case "accountId": {
      const value = action.id === "accountId" ? (credentialEnv().JASKMONEY_CF_ACCOUNT_ID ?? "") : ""
      opened.patch({ field: { action: action.id, value, caret: value.length }, note: null })
      return
    }
    case "page": {
      const page = KEY_PAGES[row]
      if (page) { openBrowser(page.url); note(`${page.site} should open in your browser; paste the key here when you have it`, null) }
      return
    }
    case "test":
      opened.patch({ busy: true, note: { text: "Testing…", ok: null } })
      void testAi(row).then((result) => note(result.text, result.ok))
      return
    case "remove":
      // Enter twice (state/armed); moving off the row disarms, like any key.
      confirmTwice(ui, data, { kind: "aiKey", id: row, label: aiRowLabel(row), with: "enter" }, (text) => opened.patch({ cursor: 0, note: { text, ok: true } }))
      return
  }
}

/** The browser sign-in modal: it owns input; esc cancels, and when pi-ai
 * asks, the code or redirect URL is typed or pasted and enter sends it. */
function handleLlmSignIn(ui: UiStore, key: KeyEvent): void {
  const flow = ui.state.llmSignIn
  if (!flow) return
  if (key.name === "escape") { cancelLlmSignIn(); return }
  if (!flow.paste) return
  if (key.name === "return" || key.name === "enter") { submitSignInPaste(ui); return }
  const next = editText({ value: flow.paste.value, caret: flow.paste.caret }, key)
  if (next) ui.setState("llmSignIn", "paste", { value: next.value, caret: next.caret })
}

/** Appearance input matrix: navigation changes only its cursor; enter changes
 * its row's preference; esc leaves the pane and keeps the cursor. Modal scopes
 * take precedence in activeScope. Display rows moved here by request. */
function handleSettingsAppearance(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  if (name === "escape") { ui.leaveSettings(); return }
  const moved = listMove(key, ui.state.appearanceCursor, APPEARANCE_ROWS.length)
  if (moved != null) { ui.setState({ appearanceCursor: moved }); return }
  if (name !== "return" && name !== "enter") return
  switch (APPEARANCE_ROWS[ui.state.appearanceCursor]) {
    case "theme": if (data) openThemePicker(ui, data); return
    case "icons": if (data) toggleIcons(ui, data); return
    case "xAxis": if (data) toggleXAxis(ui, data); return
    case "chartMotion": if (data) toggleChartMotion(ui, data); return
    case "chartSpeed": if (data) cycleChartSpeed(ui, data); return
    case "chartCurve": if (data) cycleChartCurve(ui, data); return
    case "chartLabels": if (data) toggleChartLabels(ui, data); return
    case "openRange": if (data) cycleOpenRange(ui, data); return
    case "backdrop": if (data) cycleBackdrop(ui, data); return
  }
}

function handleSettingsDatabase(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  if (name === "escape") { ui.leaveSettings(); return }
  const moved = listMove(key, ui.state.databaseCursor, DATABASE_ROWS.length)
  if (moved != null) { ui.setState({ databaseCursor: moved }); return }
  if (name !== "return" && name !== "enter") return
  switch (DATABASE_ROWS[ui.state.databaseCursor]) {
    case "import": {
      const from = ui.activeScope()
      settleData(ui, (async () => {
        const directory = await data?.importDirectory() ?? process.cwd()
        const files = await data?.csvFiles(directory) ?? []
        if (ui.activeScope() === from) ui.beginImport(directory, files)
      })())
      return
    }
    case "history": ui.setState({ importHistory: { top: 0 } }); return
    case "profiles": ui.beginImport("", []); ui.opening("importWizard").patch({ stage: "profile", managing: true }); return
    // Approved port deviation: Database & Import owns the week toggle.
    case "weekStart": if (data) toggleWeekStart(ui, data); return
    case "demo": if (data) toggleDemo(ui, data); return
    case "clearData": confirmTwice(ui, data, { kind: "clearData", id: 0, label: "all transaction and import data", with: "enter" }); return
    case "reset": ui.setState({ factoryReset: { draft: "", caret: 0, busy: false } }); ui.setStatus("Type RESET then enter to remove this SQLite database"); return
  }
}

/** esc in Transactions steps back one level (K3): the selection, then a
 * drill-down (back to Overview: its filter is the drill), then the filter,
 * then a special view (tag review, then the Uncategorised view). Approved
 * OpenTUI deviation from legacy, where u cleared and views had own keys. */
function stepBack(ui: UiStore, data?: DataStore): void {
  if (Object.keys(ui.state.selectedIds).length || (ui.state.range != null)) { ui.clearSelection(); ui.setStatus("Selection cleared"); return }
  if (!data) return
  const back = ui.state.drillReturn
  if (back) {
    if (back.filter) data.commitFilter(back.filter)
    else data.clearFilter()
    ui.switchTab("overview")
    ui.setState({ focusedSection: back.focus })
    ui.setStatus("Overview")
    return
  }
  if (data.state.filterQuery) { clearTransactionFilter(ui, data); return }
  if (data.state.tagReview) { endTagReview(ui, data); return }
  if (data.state.uncategorisedOnly) { toggleUncategorised(ui, data); return }
  ui.setStatus("Nothing to clear")
}

function handleManagerTxns(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name, sequence: seq } = key
  const rows = data?.scopedTransactions() ?? []
  ui.ensureRange(rows)
  if (savedFilterKeys(ui, data, key)) return
  // u undoes the last change (dataStore.undo); esc clears, below.
  if (name === "u" && data) { runUndo(ui, data); return }

  if ((name === "." || seq === ".") && data) {
    if (!data.lastRepeat()) { ui.setStatus("Nothing to repeat"); return }
    settleData(ui, data.repeatLast(ui.targetIds(rows)), (summary) => ui.setStatus(summary, summary.includes("failed:")))
    return
  }

  // Step through the accounts pane from the table.
  if (name === "a" && !key.shift && data) { stepAccount(ui, data); return }
  if (name === "m") { ui.setState({ txnView: "merchants", merchantCursor: 0, merchantTop: 0 }); ui.setStatus("Grouped by merchant · m for rows"); return }
  // N: a note on the row's merchant (what you buy there), for suggestions.
  if ((name === "N" || (name === "n" && key.shift)) && data) {
    const row = data.scopedTransactions()[ui.state.managerCursor]
    if (row) openMerchantNote(ui, data, row.description)
    return
  }
  // With ask: terms, n shows near misses too (rows Jev hasn't settled).
  if (name === "n" && !key.shift && data && askTerms(data.state.filterExpr).length) {
    const on = !data.nearMissesShown()
    data.setAskLoose(on)
    ui.jumpManagerCursor(0, data.scopedTransactions().length)
    const counts = data.askCounts()
    const tally = `${counts?.matches ?? 0} match, ${counts?.near ?? 0} near`
    ui.setStatus(on ? `${tally}: near misses below the matches (n hides them)` : `${tally}: matches only (n shows the near)`)
    return
  }
  // R: rules offered from what you've categorised the same way repeatedly.
  if (name === "r" && key.shift && data) {
    const n = data.allRuleOffers().length
    // With a model to ask, the list opens on the final action row when empty.
    if (!n && !!!data?.state.llm) { ui.setStatus(`No rule to offer: one comes after you put a description in the same category ${RULE_AFTER} times`); return }
    ui.setState({ ruleOffers: { cursor: 0, busy: false } })
    ui.setStatus(n ? `${count(n, "rule")} offered` : "No rules offered yet · enter asks the AI")
    return
  }
  // Tag review: a tag's candidates, accepted (y, Y) or dismissed (x) like
  // category suggestions; T chooses another tag, esc leaves.
  if (name === "t" && key.shift && data) { ui.setState({ tagChooser: { cursor: 0, query: "" } }); ui.setStatus("Find transactions for a tag · type to filter or name a new one"); return }
  const review = data?.state.tagReview
  if (review && data) {
    if (name === "y" && !key.shift) { void runTagAccept(ui, data, ui.targetIds(rows)); return }
    if (name === "y" && key.shift) {
      const ids = rows.filter((r) => (review.candidates[r.id]?.confidence ?? 0) >= ACCEPT_ALL_AT).map((r) => r.id)
      if (!ids.length) { ui.setStatus(`No candidate is ${ACCEPT_ALL_AT * 100}% sure or more`); return }
      ui.setState({ acceptPreview: ids })
      return
    }
    if (name === "x" && !key.shift) {
      const ids = ui.targetIds(rows).filter((id) => review.candidates[id])
      settleData(ui, data.dismissTagCandidates(ids), () => {
        ui.clearSelection()
        ui.jumpManagerCursor(Math.min(ui.state.managerCursor, Math.max(0, data.scopedTransactions().length - 1)), data.scopedTransactions().length)
        ui.setStatus(ids.length ? `Dismissed ${count(ids.length, "candidate")} for this session` : "No candidate to dismiss")
      })
      return
    }
  }
  // The Uncategorised view: rows waiting for a category, with suggestions
  // to accept (y: these rows, Y: every confident one) or dismiss (x).
  if (name === "i" && !key.shift && data) { if (review) data.closeTagReview(); toggleUncategorised(ui, data); return }
  if (data?.state.uncategorisedOnly) {
    if (name === "y" && !key.shift) { void runAccept(ui, data, ui.targetIds(rows)); return }
    if (name === "y" && key.shift) {
      // Several rows, possibly pushed to Up: show what it would do first.
      const ids = rows.filter((r) => (data.state.suggestions[r.id]?.confidence ?? 0) >= ACCEPT_ALL_AT).map((r) => r.id)
      if (!ids.length) { ui.setStatus(`No suggestion is ${ACCEPT_ALL_AT * 100}% sure or more`); return }
      ui.setState({ acceptPreview: ids })
      return
    }
    if (name === "x" && !key.shift) {
      const ids = ui.targetIds(rows).filter((id) => data.state.suggestions[id])
      settleData(ui, data.dismissSuggestions(ids), () => {
        ui.clearSelection()
        ui.setStatus(ids.length ? `Dismissed ${count(ids.length, "suggestion")}` : "No suggestion to dismiss")
      })
      return
    }
  }
  if (name === "return" || name === "enter") {
    openTransaction(ui, data)
    return
  }
  if (isSmartSearchKey(key)) { openSmartSearch(ui, data); return }
  if (name === "/" || seq === "/") {
    ui.openFilter(data?.state.filterQuery ?? "")
    return
  }
  if (name === "escape") { stepBack(ui, data); return }
  if (name === "s" && !key.shift) {
    const col = data?.cycleSortColumn() ?? "date"
    ui.jumpManagerCursor(0, rows.length)
    ui.setStatus(`Sort: ${col} ${data?.state.sortAscending ? "↑" : "↓"}`)
    return
  }
  if ((name === "s" && key.shift) || name === "S") {
    const asc = data?.toggleSortDirection() ?? false
    ui.setStatus(`Sort: ${data?.state.sortColumn ?? "date"} ${asc ? "↑" : "↓"}`)
    return
  }
  if (name === "c") {
    if (rows.length === 0) {
      ui.setStatus("No row to categorize", true)
      return
    }
    openCategoryPicker(ui, ui.targetIds(rows), data)
    return
  }
  if (name === "t") {
    if (rows.length === 0) {
      ui.setStatus("No row to tag", true)
      return
    }
    ui.openTagPicker(ui.targetIds(rows))
    return
  }
  if (name === "space" || seq === " ") {
    const hl = ui.highlightedIds(rows)
    const hlIds = Object.keys(hl).map(Number)
    if ((ui.state.range != null) && hlIds.length > 0) {
      const allOn = hlIds.every((id) => ui.state.selectedIds[id])
      const next = { ...ui.state.selectedIds }
      for (const id of hlIds) {
        if (allOn) delete next[id]
        else next[id] = true
      }
      ui.setState({ selectedIds: next, range: null })
      ui.setStatus(allOn ? `Deselected ${hlIds.length}` : `Selected ${hlIds.length}`)
    } else {
      const row = rows[ui.state.managerCursor]
      if (row) {
        ui.toggleSelectedId(row.id)
      }
    }
    return
  }
  const moved = listMove(key, ui.state.managerCursor, rows.length, ui.state.managerVisible)
  if (moved != null) {
    if (isJump(key)) {
      ui.jumpManagerCursor(moved, rows.length)
      ui.setRangeFromMove(0, 0, false)
      ui.setStatus(seq === "G" || name === "end" || key.shift ? "Bottom" : "Top")
    } else moveTxnCursor(ui, data, moved - ui.state.managerCursor, key.shift)
    return
  }
}

export function openTransaction(ui: UiStore, data?: DataStore): void {
  const row = data?.scopedTransactions()[ui.state.managerCursor]
  if (row) ui.setState({ detail: { id: row.id, boughtTop: 0, notes: null } })
}

export function selectAccountRow(ui: UiStore, data: DataStore, index: number): void {
  const row = accountStacks(data.state.accounts).flatMap((stack) => stack.rows)[index]
  if (row && row.selection !== data.state.accountSelection) changeAccountScope(ui, data, row.selection, "accounts")
}

export function moveOverviewCategory(ui: UiStore, data: DataStore, index: number): void {
  const lines = allCategoryLines(overviewRange(data, ui.state))
  ui.setState({ overviewCategoryCursor: Math.max(0, Math.min(lines.length - 1, index)) })
}

export function openBarItem(ui: UiStore, data: DataStore | undefined, id: string): void {
  const tab = TABS.find((tab) => id === `bar.${tab.id}`)
  if (tab) ui.switchTab(tab.id)
  else if (id === "bar.web") {
    const served = web.serving()
    if (served) { web.open(served.page); ui.setStatus(`Opening ${served.page}`) }
  } else if (id === "bar.sync" && data) void runSync(ui, data, { manual: true })
  else if (id === "bar.version") void showVersion(ui)
}

/** The version's word on updates, in the status line (once per change). */
export async function showVersion(ui: UiStore): Promise<void> {
  const text = await describeVersion()
  if (ui.state.status !== text) ui.setStatus(text)
}

function handleManagerAccounts(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  if (!data) return
  const stacks = accountStacks(data.state.accounts)
  const rows = stacks.flatMap((stack) => stack.rows)
  const at = rows.findIndex((row) => row.selection === data.state.accountSelection)
  const select = (index: number) => selectAccountRow(ui, data, index)
  // j/k move down the stacks in reading order; h/l go to the first row of
  // the stack beside.
  const moved = listMove(key, Math.max(0, at), rows.length)
  if (moved != null) { select(moved); return }
  const step = name === "h" || name === "left" ? -1 : name === "l" || name === "right" ? 1 : 0
  if (step) {
    const firsts = stacks.map((_, i) => stacks.slice(0, i).reduce((n, stack) => n + stack.rows.length, 0))
    const stack = firsts.findLastIndex((first) => first <= at)
    const next = firsts[stack + step]
    if (next != null && stacks[stack + step]!.rows.length) select(next)
    return
  }
  if (name === "return" || name === "enter") { ui.setState({ focusedSection: "mgr.transactions" }); return }
  const accountId = rows[at]?.accountId
  if ((name === "d" || name === "delete") && accountId != null) { ui.setState({ accountAction: { cursor: 0, id: accountId } }); ui.setStatus("Account data · enter twice to clear or remove · esc cancel"); return }
}

/** The cycle the Budgets tab shows and the budgets in force in it. */
function viewedBudgets(ui: UiStore, data: DataStore) {
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
  // A cycle pane steps through CYCLE_VIEWS only.
  const views: [number, number] = [...ui.state.budgetCycleViews]
  const at = Math.max(0, CYCLE_VIEWS.indexOf(views[pane - 1]!))
  views[pane - 1] = CYCLE_VIEWS[(at + step + CYCLE_VIEWS.length) % CYCLE_VIEWS.length]!
  ui.setState({ budgetCycleViews: views })
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
  if (name === "escape") { ui.setState({ focusedSection: "bud.list" }); return }
  if (name === "j" || name === "down") { travel(ui, "down", data); return }
  if (name === "k" || name === "up") { travel(ui, "up", data); return }
  budgetKeys(ui, key, data, Math.max(0, BUDGET_PANES.indexOf(ui.state.focusedSection)))
}

/** The Budgets tab's Progress card (its budgets): enter edits a budget
 * (the total is theirs added up: it has none of its own), a adds, del twice
 * deletes; j past the end or k above the start go to the pane that way. */
function handleBudgets(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  if (!data) return
  if (budgetKeys(ui, key, data)) return
  const view = viewedBudgets(ui, data)
  const rows = budgetListRows(view.budgets, data.state.categories)
  const row = rows[Math.min(ui.state.budgetCursor, rows.length - 1)]!
  // Past the last budget or above the first: the pane in that direction
  // (Progress tops the main column: the budget pane is under it).
  if ((name === "j" || name === "down") && ui.state.budgetCursor >= rows.length - 1) { travel(ui, "down", data); return }
  if ((name === "k" || name === "up") && ui.state.budgetCursor === 0) { travel(ui, "up", data); return }
  const moved = listMove(key, ui.state.budgetCursor, rows.length)
  if (moved != null) { ui.setState({ budgetCursor: moved }); return }
  if (name === "a") {
    const taken = new Set(data.state.budgets.map((b) => scopeKey(b.scope)))
    const free = budgetScopeOptions(data.state.accounts, data.state.categories).find((o) => !taken.has(o.key))
    ui.openSettingsEditor("budget", null, { ...ui.state.settingsDraft, ...cycleDraft(data.state.budgetCycle), scopeKey: free?.key ?? "overall", amount: "" })
    return
  }
  if (name === "return" || name === "enter") {
    if (row.kind === "total") { ui.setStatus("The total is your budgets added up: set everything else, or a category's", true); return }
    if (row.kind === "overall") openBudgetEditor(ui, data, row.budget, { kind: "overall" }, 0)
    else openBudgetEditor(ui, data, row.budget, row.budget.scope, row.budget.amount)
    return
  }
  if ((name === "delete" || name === "backspace") && row.budget) {
    confirmTwice(ui, data, { kind: "budget", id: budgetArmId(row.budget, view.cycle.start), label: `the ${budgetLabel(row.budget, data.state.accounts, data.state.categories)} budget${view.current ? "" : ` from ${shortDate(view.cycle.start)}`}`, with: "delete" })
  }
}

/** The Budgets pane's rows, as the tab draws them. */
function setupRows(ui: UiStore, data: DataStore): SetupRow[] {
  const view = viewedBudgets(ui, data)
  return budgetSetupRows(budgetLines(ui, data), view.budgets, new Set(ui.state.budgetSetupOpen), budgetIgnoredIds(data.state.categories))
}

/** The Budgets tab's Budgets pane: enter sets or edits the overall budget
 * (a new one starts from its average) or the budget of the
 * group or category at the cursor (a new one starts from its average:
 * allocating down), space opens or closes a group, del twice removes a
 * budget, x leaves a category out of the overall budget (or brings it
 * back); k past the top goes back to Progress. */
function handleBudgetCategories(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  if (!data) return
  if (budgetKeys(ui, key, data)) return
  const view = viewedBudgets(ui, data)
  const rows = setupRows(ui, data)
  const cursor = Math.min(ui.state.budgetCategoryCursor, Math.max(0, rows.length - 1))
  if ((name === "k" || name === "up") && cursor === 0) {
    ui.setState({ focusedSection: "bud.list", budgetCursor: budgetListRows(view.budgets, data.state.categories).length - 1 })
    return
  }
  const moved = listMove(key, cursor, rows.length)
  if (moved != null) { ui.setState({ budgetCategoryCursor: moved }); return }
  const row = rows[cursor]
  if (!row) return
  if (row.kind === "overall") {
    if (name === "return" || name === "enter") { openBudgetEditor(ui, data, row.budget, { kind: "overall" }, row.average); return }
    if ((name === "delete" || name === "backspace") && row.budget) {
      confirmTwice(ui, data, { kind: "budget", id: budgetArmId(row.budget, view.cycle.start), label: `the ${row.name.toLowerCase()} budget${view.current ? "" : ` from ${shortDate(view.cycle.start)}`}`, with: "delete" })
    }
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

function handleManagerMerchants(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name, sequence: seq } = key
  if (!data) return
  if (savedFilterKeys(ui, data, key)) return
  // u undoes the last change (dataStore.undo); esc clears, below.
  if (name === "u" && data) { runUndo(ui, data); return }

  // The same filtered, scoped rows as the table, summarised per merchant.
  const groups = sortMerchantGroups(groupByMerchant(data.scopedTransactions()), ui.state.merchantSort, ui.state.merchantReverse)
  const group = groups[ui.state.merchantCursor]
  const moveTo = (i: number) => ui.setState({ merchantCursor: Math.max(0, Math.min(groups.length - 1, i)) })
  if (name === "a" && !key.shift) { stepAccount(ui, data); ui.setState({ merchantCursor: 0 }); return }
  if (name === "m") { toTransactions(ui); ui.setStatus("Transactions"); return }
  const moved = listMove(key, ui.state.merchantCursor, groups.length, ui.state.managerVisible)
  if (moved != null) { moveTo(moved); return }
  if (name === "s" && !key.shift) {
    const next = MERCHANT_SORTS[(MERCHANT_SORTS.indexOf(ui.state.merchantSort) + 1) % MERCHANT_SORTS.length]!
    ui.setState({ merchantSort: next, merchantReverse: false, merchantCursor: 0 })
    ui.setStatus(`Merchants by ${next}`)
    return
  }
  if ((name === "s" && key.shift) || name === "S") { ui.setState({ merchantReverse: !ui.state.merchantReverse, merchantCursor: 0 }); return }
  if (isSmartSearchKey(key)) { openSmartSearch(ui, data); return }
  if (name === "/" || seq === "/") { ui.openFilter(data.state.filterQuery); return }
  if ((name === "return" || name === "enter") && group) {
    // Drill in: narrow the filter to this merchant and show its rows.
    const result = data.commitFilter(merchantFilter(data.state.filterQuery, group.merchant))
    if (!result.ok) { ui.setStatus(result.err, true); return }
    toTransactions(ui)
    ui.jumpManagerCursor(0, data.scopedTransactions().length)
    ui.setStatus(`${group.merchant} · ${count(group.count, "transaction")} · esc to widen`)
    return
  }
  if (name === "c" && group) { openCategoryPicker(ui, group.ids, data); return }
  if (name === "t" && group) { ui.openTagPicker(group.ids); return }
  if (name === "n" && !key.shift && group) { openMerchantNote(ui, data, group.merchant); return }
  if (name === "escape") {
    if (data.state.filterQuery) clearTransactionFilter(ui, data)
    else { toTransactions(ui); ui.setStatus("Transactions") }
    return
  }
}

function handleOverview(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name, sequence: seq } = key
  const scope = ui.activeScope()
  const clock = appNow()
  const cycle = data?.cycle()
  // Approved deviation, user request 2026-11-01: arrows travel panes.
  // Legacy keys.go:232 binds left/right only in the timeframe scope;
  // h/l, ,/., H/L still step charts. Range arrows keep chip movement.
  if (name === "up" || name === "down" || name === "left" || name === "right") {
    if (data && ui.state.focusedSection === "ov.categories" && (name === "up" || name === "down")) {
      const last = allCategoryLines(overviewRange(data, ui.state)).length - 1
      const cursor = Math.min(ui.state.overviewCategoryCursor, last)
      if (name === "up" ? cursor > 0 : cursor < last) {
        moveOverviewCategory(ui, data, cursor + (name === "up" ? -1 : 1))
        return
      }
    }
    travel(ui, name, data)
    return
  }
  // h/l (or ,/.) step the focused chart pane's views, the top pane when
  // none is focused; H/L step the bottom pane (in the 2×2 grid, the bottom
  // of the focused pane's column), or the one chart when the Overview
  // shows only one.
  const back = seq === "H" || ((name === "h" || seq === ",") && scope === "overview")
  const forward = seq === "L" || ((name === "l" || seq === ".") && scope === "overview")
  if (back || forward) {
    const focused = chartPaneOf(ui.state.focusedSection)
    const shown = ui.state.overviewCharts
    const bottom = shown === 4 && (focused === 2 || focused === 3) ? 3 : shown > 1 ? 1 : 0
    const pane = seq === "H" || seq === "L" || key.shift ? bottom : focused >= 0 && focused < shown ? focused : 0
    const n = CHART_VIEWS.length
    const views: ChartViews = [...ui.state.chartViews]
    views[pane] = (views[pane] + (back ? -1 : 1) + n) % n
    ui.setState({ chartViews: views })
    return
  }
  // d / D: the next or previous date range chip, applied at once (no need
  // to focus the Date Range first). Custom joins once a range exists.
  if (name === "d" && !key.ctrl && !key.meta) {
    const index = stepChip(ui.state.timeframe, key.shift || seq === "D" ? -1 : 1)
    const tf = applyChip(ui.state.timeframe, index, clock, cycle)
    ui.setTimeframe(tf)
    ui.setDashChipCursor(index)
    ui.setStatus(`${chipLabel(index)} · ${timeframeBounds(tf, clock, cycle).label}`)
    return
  }
  // i: review what's waiting for a category, in Transactions.
  if (name === "i" && !key.shift && scope === "overview" && data) {
    toTransactions(ui)
    if (!data.state.uncategorisedOnly) toggleUncategorised(ui, data)
    return
  }
  // / searches: the Transactions filter, opened from here (the Overview
  // itself is not filtered); ? goes straight to a smart search.
  if (isSmartSearchKey(key) && scope === "overview") {
    toTransactions(ui)
    openSmartSearch(ui, data)
    return
  }
  if ((name === "/" || seq === "/") && scope === "overview") {
    toTransactions(ui)
    ui.openFilter(data?.state.filterQuery ?? "")
    return
  }
  // Which spending account the period covers: all, or one of them.
  if (name === "a" && data) {
    // With one spending account it is all spending: nothing to switch.
    const spending = data.state.accounts.filter((a) => accountRole(a) === "spending")
    const choices: AccountSelection[] = ["all", ...(spending.length > 1 ? spending.map((a) => a.id) : [])]
    const at = choices.indexOf(data.state.accountSelection)
    const next = choices[(at + 1) % choices.length]!
    changeAccountScope(ui, data, next, "overview")
    ui.setStatus(`Overview · ${spendingScope(data.state.accounts, next).label}`)
    return
  }
  if (name === "[" || seq === "[" || name === "]" || seq === "]") {
    stepOverviewRange(ui, name === "[" || seq === "[" ? -1 : 1, data)
    return
  }
  // Drill-down (Go app): enter opens Transactions filtered to the focused
  // category line, or to all the range's spending from a chart; esc there
  // comes back. With Categories focused, j/k move over every line.
  const focus = ui.state.focusedSection
  if (data && focus === "ov.categories") {
    const lines = allCategoryLines(overviewRange(data, ui.state))
    const moveTo = (i: number) => moveOverviewCategory(ui, data, i)
    const moved = listMove(key, ui.state.overviewCategoryCursor, lines.length)
    if (moved != null) { moveTo(moved); return }
    const line = lines[Math.min(ui.state.overviewCategoryCursor, lines.length - 1)]
    if ((name === "return" || name === "enter") && line) { drillDown(ui, data, line); return }
  }
  if (focus === "ov.accounts" && (name === "return" || name === "enter")) { ui.switchTab("manager"); ui.setState({ focusedSection: "mgr.accounts" }); return }
  if (data && chartPaneOf(focus) >= 0 && (name === "return" || name === "enter")) { drillDown(ui, data); return }
  if (name === "0") {
    // The same kind of range, now (this month, this quarter…).
    const tf = timeframeNow(ui.state.timeframe, appNow(), cycle)
    ui.setTimeframe(tf)
    ui.setStatus(`Now · ${timeframeBounds(tf, clock, cycle).label}`)
    return
  }
  if (name === "z" && data) {
    // Balance charts: fit the balances, or run the axis from $0.
    settleData(ui, data.saveUiPrefs({ zeroAxis: !data.state.uiPrefs.zeroAxis }), () => ui.setStatus(data.state.uiPrefs.zeroAxis ? "Balance charts from $0" : "Balance charts fit their balances"))
    return
  }
  if (shifted(key, "c") && !key.ctrl && !key.meta) { openCustomRange(ui, cycle); return }
  if (name === "c" && !key.ctrl && !key.meta) {
    // Home: the current budget cycle, whatever the range was.
    const tf = applyChip({ ...ui.state.timeframe, family: "period", period: "cycle" }, LOOKBACKS.length, appNow(), cycle)
    ui.setTimeframe(tf)
    ui.setDashChipCursor(activeChipIndex(tf))
    ui.setStatus(`This cycle · ${timeframeBounds(tf, clock, cycle).label}`)
    return
  }
  if (name === "escape" && ui.state.focusedSection !== "none") ui.clearFocus()
}

/** [ or ] (or a click on one in the Date Range card): the range before or
 * after this one (stepRange). */
export function stepOverviewRange(ui: UiStore, delta: -1 | 1, data?: DataStore): void {
  const clock = appNow()
  const cycle = data?.cycle()
  const was = ui.state.timeframe
  const tf = stepRange(was, delta, clock, cycle)
  ui.setTimeframe(tf)
  ui.setDashChipCursor(activeChipIndex(tf))
  const kind = tf.family === "period" ? PERIOD_LABEL[tf.period] : tf.family === "lookback" ? tf.lookback : "Custom"
  const offset = rangeOffsetLabel(tf, clock, cycle)
  ui.setStatus(`${kind} · ${timeframeBounds(tf, clock, cycle).label}${offset ? ` · ${offset} · 0 for now` : ""}`)
}

/** The Custom range dialog, starting from the last custom range or the
 * range on screen. */
function openCustomRange(ui: UiStore, cycle: CycleConfig | undefined): void {
  const from = ui.state.timeframe.custom ?? timeframeBounds(ui.state.timeframe, appNow(), cycle)
  ui.setState({ customEdit: {
    // The calendar has the focus: arrows move its cursor; tab to type.
    start: textField(rangeDayText(from.start)), end: textField(rangeDayText(from.end)), focus: "grid", error: "",
    view: "days", cursor: from.start, mark: null, before: null,
  } })
}

export function handleOverviewRange(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  const clock = appNow()
  const cycle = data?.cycle()
  if (name === "up" || name === "down" || (name === "left" && ui.state.dashChipCursor === 0) || (name === "right" && ui.state.dashChipCursor === chipCount() - 1)) {
    travel(ui, name, data)
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


/** ctrl+s saves the current filter (the editor opens on its name); ctrl+l
 * opens the saved filters to apply one (Go app). Both Transactions views. */
function savedFilterKeys(ui: UiStore, data: DataStore | undefined, key: KeyEvent): boolean {
  if (!key.ctrl) return false
  if (key.name === "s") {
    const expr = data?.state.filterQuery ?? ""
    if (!expr) { ui.setStatus("No filter to save"); return true }
    ui.openSettingsEditor("filter", null, { ...ui.state.settingsDraft, id: nextSavedFilterId(data?.state.savedFilters ?? []), name: "", expr })
    ui.setState("settingsEditor", { field: 1, caret: 0 })
    return true
  }
  if (key.name === "l") { ui.setState({ filterPicker: { query: "", cursor: 0 } }); return true }
  return false
}

/** Open Transactions on the Overview range's spending, narrowed to one
 * category line when given, remembering where to come back to. */
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

type HintState = Pick<UiState, "focusedSection" | "drillReturn" | "chartViews"> & {
  /** What [ and ] step the Overview's range by (stepUnit). */
  stepUnit?: string
  /** The Overview's range is a Custom one (C edits its dates). */
  customRange?: boolean
  /** The Overview's chart panes on screen (one: no bottom-chart keys). */
  overviewCharts?: OverviewCharts
  /** The Budgets tab's cycle panes on screen (none: no H/L). */
  budgetCyclePanes?: 0 | 1 | 2
  /** From the data store: the Transactions table is the Uncategorised view. */
  uncategorisedOnly?: boolean
  /** In the filter: ↑ would bring back the smart search's question. */
  recallQuestion?: boolean
  /** The AI models dialog is taking a key, account id or model. */
  aiField?: boolean
  executorWaiting?: boolean
  welcomeStep?: string
  welcomeTyping?: boolean
  welcomeBusy?: boolean
  /** Trying a tour demo: which. */
  welcomeTry?: number | null
  /** The tour's demo shown can be tried. */
  welcomeTriable?: boolean
  boughtScrolls?: boolean
  /** The sign-in modal is asking for a pasted code or URL. */
  signInPaste?: boolean
  /** A tag review is open. */
  tagReview?: boolean
  /** The search help shows its full version. */
  searchHelp?: Pick<NonNullable<UiState["searchHelp"]>, "full"> | null
  /** Rules offered (R). */
  ruleOfferCount?: number
  /** The filter has `ask:` terms; whether near misses are shown. */
  asks?: boolean
  askLoose?: boolean
}
type ScopeEntry = {
  handle: (ui: UiStore, key: KeyEvent, data?: DataStore) => void
  hints: (state?: HintState) => Hint[]
  /** Not text entry: the palette (ctrl+k) and the ctrl aliases work here. */
  list: boolean
}

const scopes: Record<ScopeId, ScopeEntry> = {
  "palette": {
    handle: handlePalette,
    list: false,
    hints: () => [{ key: "↑↓ ^j/k", desc: "move" }, { key: "enter", desc: "run" }, { key: "esc", desc: "close" }, { key: "type", desc: "filter" }],
  },
  "filterPicker": {
    handle: handleFilterPicker,
    list: false,
    hints: () => [{ key: "↑↓ ^j/k", desc: "move" }, { key: "enter", desc: "apply" }, { key: "esc", desc: "close" }, { key: "type", desc: "filter" }],
  },
  "themePicker": {
    handle: handleThemePicker,
    list: false,
    hints: () => [{ key: "↑↓ j/k", desc: "preview" }, { key: "enter", desc: "keep" }, { key: "esc", desc: "put back" }],
  },
  "modelPicker": {
    handle: handleModelPicker,
    list: false,
    hints: () => [{ key: "type", desc: "filter" }, { key: "↑↓", desc: "move" }, { key: "enter", desc: "use it" }, { key: "esc", desc: "leave it" }],
  },
  "dryRun": {
    handle: handleDryRun,
    list: false,
    hints: () => [{ key: "j/k", desc: "scroll" }, { key: "esc", desc: "close" }],
  },
  "jump": {
    handle: handleJump,
    list: false,
    hints: () => [
      { key: "letter", desc: "jump" },
      { key: "esc", desc: "cancel" },
    ],
  },
  "tagPicker": {
    handle: handleTagPicker,
    list: false,
    hints: () => [
      { key: "↑↓ ^j/k", desc: "move" },
      { key: "space", desc: "stage" },
      { key: "enter", desc: "apply" },
      { key: "esc", desc: "cancel" },
    ],
  },
  "tagChooser": {
    handle: handleTagChooser,
    list: false,
    hints: () => [{ key: "↑↓ ^j/k", desc: "move" }, { key: "type", desc: "filter or new tag" }, { key: "enter", desc: "find" }, { key: "esc", desc: "cancel" }],
  },
  "catPicker": {
    handle: handleCatPicker,
    list: false,
    hints: () => [
      { key: "↑↓ ^j/k", desc: "move" },
      { key: "enter", desc: "apply" },
      { key: "esc", desc: "cancel" },
      { key: "type", desc: "filter" },
    ],
  },
  "filter": {
    handle: handleFilter,
    list: false,
    hints: (state) => [
      { key: "enter", desc: "apply" },
      { key: "esc", desc: "clear" },
      { key: "type", desc: "JQL" },
      { key: "?…", desc: "ask in words" },
      { key: "F1", desc: "help" },
      ...(state?.recallQuestion ? [{ key: "↑", desc: "your question" }] : []),
    ],
  },
  "manager.detail": {
    handle: handleManagerDetail,
    list: false,
    hints: (state) => [{ key: "j/k", desc: "prev/next" }, ...(state?.boughtScrolls ? [{ key: "J/K", desc: "scroll bought" }] : []), { key: "c", desc: "category" }, { key: "t", desc: "tags" }, { key: "n", desc: "notes" }, { key: "N", desc: "merchant note" }, { key: "esc", desc: "close" }],
  },
  "overview.custom": {
    handle: handleOverviewCustom,
    list: false,
    hints: () => [
      { key: "tab", desc: "field" },
      { key: "enter", desc: "apply" },
      { key: "esc", desc: "cancel" },
    ],
  },
  "settings.factoryReset": {
    handle: handleSettingsFactoryReset,
    list: false,
    hints: () => [{ key: "type RESET", desc: "confirm" }, { key: "enter", desc: "erase DB" }, { key: "esc", desc: "cancel" }],
  },
  "searchHelp": {
    handle: handleSearchHelp,
    list: false,
    hints: (state) => [{ key: "m", desc: state?.searchHelp?.full ? "brief" : "full grammar" }, { key: "j/k", desc: "scroll" }, { key: "esc", desc: "close" }],
  },
  "merchantNote": {
    handle: handleMerchantNote,
    list: false,
    hints: () => [{ key: "enter", desc: "save (empty removes)" }, { key: "esc", desc: "cancel" }],
  },
  "settings.upAccounts": {
    handle: handleUpAccounts,
    list: false,
    hints: () => [{ key: "j/k", desc: "move" }, { key: "enter", desc: "sync on/off" }, { key: "s", desc: "sync now" }, { key: "esc", desc: "close" }],
  },
  "settings.aiUse": {
    handle: handleAiUse,
    list: false,
    hints: () => [{ key: "j/k", desc: "move" }, { key: "enter", desc: "do" }, { key: "esc", desc: "close" }],
  },
  "settings.aiSent": {
    handle: handleAiSent,
    list: false,
    hints: () => [{ key: "j/k", desc: "scroll" }, { key: "esc", desc: "back" }],
  },
  "settings.aiDialog": {
    handle: handleAiDialog,
    list: false,
    hints: (state) => state?.aiField ? [{ key: "enter", desc: "save" }, { key: "esc", desc: "back" }] : [{ key: "j/k", desc: "move" }, { key: "enter", desc: "do" }, { key: "esc", desc: "close" }],
  },
  "welcome": {
    handle: handleWelcome,
    list: false,
    hints: (state) => state?.welcomeBusy ? [{ key: "esc", desc: "stop waiting" }]
      : state?.welcomeTry != null ? [...tryHints(state.welcomeTry), { key: "esc", desc: "back to the demo" }]
      : state?.welcomeTyping ? [{ key: "paste", desc: "your token" }, { key: "enter", desc: "connect" }, { key: "ctrl+o", desc: "open api.up.com.au" }, { key: "ctrl+n", desc: "skip" }, { key: "esc", desc: "back" }]
      : [...(state?.welcomeStep === "tour" ? [{ key: "←→", desc: "demos" }, ...(state.welcomeTriable ? [{ key: "t", desc: "try it" }] : [])] : []), { key: "↑↓", desc: "move" }, { key: "enter", desc: "choose" }, ...(state?.welcomeStep === "done" || state?.welcomeStep === "hello" ? [] : [{ key: "s", desc: "skip" }]), ...(state?.welcomeStep === "hello" ? [{ key: "b", desc: "backdrop" }] : []), { key: "esc", desc: state?.welcomeStep === "hello" ? "skip setup" : "back" }],
  },
  "settings.executor": {
    handle: (ui, key) => handleExecutor(ui, key),
    list: false,
    hints: (state) => state?.executorWaiting ? [{ key: "esc", desc: "cancel" }] : [{ key: "j/k", desc: "move" }, { key: "enter", desc: "do" }, { key: "esc", desc: "close" }],
  },
  "llmSignIn": {
    handle: (ui, key) => handleLlmSignIn(ui, key),
    list: false,
    hints: (state) => [...(state?.signInPaste ? [{ key: "enter", desc: "send" }] : []), { key: "esc", desc: "cancel" }],
  },
  "manager.ruleOffers": {
    handle: handleRuleOffers,
    list: false,
    hints: () => [{ key: "j/k", desc: "move" }, { key: "enter", desc: "make rule" }, { key: "x", desc: "never" }, { key: "esc", desc: "later" }],
  },
  "manager.acceptPreview": {
    handle: handleManagerAcceptPreview,
    list: false,
    hints: () => [{ key: "enter", desc: "accept" }, { key: "esc", desc: "cancel" }],
  },
  "manager.accountAction": {
    handle: handleManagerAccountAction,
    list: false,
    hints: () => [{ key: "j/k", desc: "move" }, { key: "enter", desc: "do (twice)" }, { key: "esc", desc: "cancel" }],
  },
  "settings.editor": {
    handle: handleSettingsEditor,
    list: false,
    hints: () => [{ key: "↑/↓", desc: "field" }, { key: "←/→", desc: "change" }, { key: "enter", desc: "save / choose" }, { key: "esc", desc: "cancel" }],
  },
  "settings.import.files": {
    handle: handleSettingsImportFiles,
    list: false,
    hints: () => [{ key: "j/k", desc: "file" }, { key: "enter", desc: "select" }, { key: "p", desc: "path" }, { key: "esc", desc: "cancel" }],
  },
  "settings.import.path": {
    handle: handleSettingsImportPath,
    list: false,
    hints: () => [{ key: "enter", desc: "open" }, { key: "esc", desc: "back" }, { key: "type", desc: "path" }],
  },
  "settings.import.profile": {
    handle: handleSettingsImportProfile,
    list: false,
    hints: () => [{ key: "j/k", desc: "profile" }, { key: "enter", desc: "select" }, { key: "a/e", desc: "new/edit" }, { key: "del del", desc: "delete" }, { key: "esc", desc: "back" }],
  },
  "settings.import.profileEditor": {
    handle: handleSettingsImportProfileEditor,
    list: false,
    hints: () => [{ key: "tab", desc: "field" }, { key: "h/l", desc: "choice" }, { key: "enter", desc: "save" }, { key: "esc", desc: "back" }],
  },
  "settings.import.preview": {
    handle: handleSettingsImportPreview,
    list: false,
    hints: () => [{ key: "s", desc: "skip dupes" }, { key: "a", desc: "force import" }, { key: "p", desc: "all/dupes" }, { key: "r", desc: "rules" }, { key: "esc", desc: "cancel" }],
  },
  "settings": {
    handle: handleSettings,
    list: true,
    hints: () => [
      { key: "j/k", desc: "section" },
      { key: "h/l", desc: "column" },
      { key: "enter", desc: "activate" },
      { key: "v", desc: "jump" },
      { key: "1-4", desc: "tab" },
    ],
  },
  "settings.taxonomy": {
    handle: handleSettingsTaxonomy,
    list: true,
    hints: () => [
      { key: "j/k", desc: "move" }, { key: "space", desc: "open group" },
      { key: "enter", desc: "edit" }, { key: "a", desc: "add" },
      { key: "del del", desc: "delete" }, { key: "esc", desc: "done" },
    ],
  },
  "settings.rules": {
    handle: handleSettingsRules,
    list: true,
    hints: () => [
      { key: "j/k", desc: "move" }, { key: "enter", desc: "edit" }, { key: "space", desc: "toggle" },
      { key: "a", desc: "add", command: "add:rule" }, { key: "del del", desc: "delete", label: "Delete the rule", description: "asks again" }, { key: "S-j/k", desc: "reorder" },
      { key: "S-a", desc: "apply", command: "rules:apply" }, { key: "S-d", desc: "dry run", command: "rules:dry-run" }, { key: "esc", desc: "done" },
    ],
  },
  "settings.filters": {
    handle: handleSettingsFilters,
    list: true,
    hints: () => [{ key: "j/k", desc: "move" }, { key: "a", desc: "add", command: "add:filter" }, { key: "enter", desc: "edit" }, { key: "del del", desc: "delete" }, { key: "esc", desc: "done" }],
  },
  "settings.up": {
    handle: handleSettingsUp,
    list: true,
    hints: () => [{ key: "j/k", desc: "move" }, { key: "enter", desc: "open" }, { key: "s", desc: "sync now" }, { key: "esc", desc: "done" }],
  },
  "settings.web": {
    handle: handleSettingsWeb,
    list: true,
    hints: () => [{ key: "enter", desc: "open in browser" }, { key: "esc", desc: "done" }],
  },
  "settings.importHistory": {
    handle: handleImportHistory,
    list: true,
    hints: () => [{ key: "j/k", desc: "scroll" }, { key: "esc", desc: "close" }],
  },
  "settings.ai": {
    handle: handleSettingsAi,
    list: true,
    hints: () => [{ key: "j/k", desc: "move" }, { key: "enter", desc: "open" }, { key: "esc", desc: "done" }],
  },
  "settings.appearance": {
    handle: handleSettingsAppearance,
    list: true,
    hints: () => [{ key: "j/k", desc: "move" }, { key: "enter", desc: "switch" }, { key: "esc", desc: "done" }],
  },
  "settings.database": {
    handle: handleSettingsDatabase,
    list: true,
    hints: () => [{ key: "j/k", desc: "move" }, { key: "enter", desc: "open / switch" }, { key: "esc", desc: "done" }],
  },
  "manager.txns": {
    handle: handleManagerTxns,
    list: true,
    hints: (state) => state?.tagReview ? [
      { key: "y", desc: "tag", label: "Tag the candidate", description: "selection or row" },
      { key: "Y", desc: `tag all ≥${ACCEPT_ALL_AT * 100}%`, label: `Tag all ≥${ACCEPT_ALL_AT * 100}%…`, description: "shows them first" },
      { key: "x", desc: "dismiss", label: "Dismiss the candidate", description: "for this tag" },
      { key: "u", desc: "undo", command: "txn:undo" },
      { key: "space", desc: "select" },
      { key: "S-j/k", desc: "range" },
      { key: "T", desc: "other tag", command: "txn:tag-review" },
      { key: "esc", desc: "done" },
      { key: "s", desc: "sort" },
      { key: "enter", desc: "detail" },
    ] : state?.uncategorisedOnly ? [
      { key: "y", desc: "accept", label: "Accept the suggestion", description: "selection or row" },
      { key: "Y", desc: `accept all ≥${ACCEPT_ALL_AT * 100}%`, label: `Accept all ≥${ACCEPT_ALL_AT * 100}%…`, description: "shows them first" },
      { key: "x", desc: "dismiss", label: "Dismiss the suggestion", description: "for good" },
      { key: "u", desc: "undo", command: "txn:undo" },
      { key: "c", desc: "choose", label: "Choose a category…" },
      { key: "N", desc: "merchant note", label: "Note on the merchant…", description: "what you buy there" },
      ...(state?.ruleOfferCount ? [{ key: "R", desc: `rules (${state.ruleOfferCount})`, command: "rules:offers" }] : []),
      // The review actions first: the footer shows the first eight
      // (footerLine), and cuts at the end on narrow screens.
      { key: "space", desc: "select" },
      { key: "esc", desc: "all rows" },
      { key: "S-j/k", desc: "range" },
      { key: "i", desc: "all rows" },
      { key: "s", desc: "sort" },
      { key: "?", desc: "smart search" },
      { key: "/", desc: "filter" },
      { key: "enter", desc: "detail" },
      { key: "m", desc: "merchants" },
      { key: "v", desc: "jump" },
    ] : [
      // The first eight show in the footer (footerLine); the rest are in
      // the palette (ctrl+k).
      { key: "j/k", desc: "move" },
      { key: "c", desc: "category", label: "Categorise…", description: "selection or row" },
      { key: "t", desc: "tag", label: "Tag…", description: "selection or row" },
      { key: "space", desc: "select", label: "Select the row" },
      { key: "/", desc: "filter", command: "txn:filter" },
      { key: "?", desc: "smart search", command: "txn:smart-search" },
      { key: "u", desc: "undo", command: "txn:undo" },
      ...(state?.drillReturn ? [{ key: "esc", desc: "back" }] : [{ key: "esc", desc: "clear" }]),
      ...(state?.ruleOfferCount ? [{ key: "R", desc: `rules (${state.ruleOfferCount})`, command: "rules:offers" }] : []),
      ...(state?.asks ? [{ key: "n", desc: state.askLoose ? "matches only" : "near misses", label: state.askLoose ? "Matches only" : "Show near misses" }] : []),
      { key: "enter", desc: "detail", label: "Open the transaction" },
      { key: ".", desc: "repeat", label: "Repeat the last change", description: "on selection or row" },
      { key: "i", desc: "uncategorised", command: "txn:uncategorised" },
      { key: "T", desc: "tag review", command: "txn:tag-review" },
      { key: "m", desc: "merchants", label: "Group by merchant" },
      { key: "N", desc: "merchant note", label: "Note on the merchant…", description: "what you buy there" },
      { key: "a", desc: "account", label: "Next account" },
      { key: "S-j/k", desc: "range" },
      { key: "s", desc: "sort", label: "Cycle the sort" },
      { key: "S-s", desc: "reverse", label: "Reverse the sort" },
      { key: "ctrl+s", desc: "save filter", command: "txn:save-filter" },
      { key: "ctrl+l", desc: "saved filters", label: "Pick a saved filter…" },
      { key: "g", desc: "top", label: "Go to the top" },
      { key: "G", desc: "bottom", label: "Go to the bottom" },
      { key: "v", desc: "jump" },
    ],
  },
  "manager.accounts": {
    handle: handleManagerAccounts,
    list: true,
    hints: () => [
      { key: "j/k", desc: "account" },
      { key: "h/l", desc: "bank" },
      { key: "enter", desc: "transactions" },
      { key: "d", desc: "data actions" },
      { key: "v", desc: "jump" },
    ],
  },
  "budgets": {
    handle: handleBudgets,
    list: true,
    hints: (state) => [{ key: "j/k", desc: "move" }, { key: "enter", desc: "edit" }, { key: "a", desc: "add" }, { key: "del del", desc: "delete" }, { key: "h/l", desc: "chart" }, ...cycleChartHint(state), { key: "[ ]", desc: "cycles" }, { key: "c", desc: "cycle" }, { key: "v", desc: "jump" }, { key: "1-4", desc: "tab" }],
  },
  "budgets.chart": {
    handle: handleBudgetChart,
    list: true,
    hints: (state) => [{ key: "h/l", desc: "view" }, { key: "j/k", desc: "panes" }, ...cycleChartHint(state).filter(() => state?.focusedSection === "bud.chart"), { key: "[ ]", desc: "cycles" }, { key: "c", desc: "cycle" }, { key: "esc", desc: "budgets" }, { key: "v", desc: "jump" }, { key: "1-4", desc: "tab" }],
  },
  "budgets.categories": {
    handle: handleBudgetCategories,
    list: true,
    hints: (state) => [{ key: "j/k", desc: "move" }, { key: "enter", desc: "set budget" }, { key: "space", desc: "open" }, { key: "x", desc: "leave out" }, { key: "del del", desc: "remove budget" }, { key: "h/l", desc: "chart" }, ...cycleChartHint(state), { key: "[ ]", desc: "cycles" }, { key: "c", desc: "cycle" }, { key: "v", desc: "jump" }, { key: "1-4", desc: "tab" }],
  },
  "manager.merchants": {
    handle: handleManagerMerchants,
    list: true,
    hints: () => [
      { key: "j/k", desc: "move" },
      { key: "enter", desc: "its transactions", label: "Its transactions" },
      { key: "c", desc: "category", label: "Categorise all of it…" },
      { key: "t", desc: "tags", label: "Tag all of it…" },
      { key: "n", desc: "note", label: "Note on the merchant…", description: "what you buy there" },
      { key: "/", desc: "filter", command: "txn:filter" },
      { key: "s", desc: "sort", label: "Cycle the sort" },
      { key: "u", desc: "undo", command: "txn:undo" },
      { key: "esc", desc: "back" },
      { key: "?", desc: "smart search", command: "txn:smart-search" },
      { key: "m", desc: "rows", label: "Back to the rows" },
      { key: "a", desc: "account", label: "Next account" },
      { key: "ctrl+s", desc: "save filter", command: "txn:save-filter" },
      { key: "ctrl+l", desc: "saved filters", label: "Pick a saved filter…" },
    ],
  },
  "bar": {
    list: true,
    handle: (ui, key, data) => {
      const { name } = key
      if (name === "left" || name === "right" || name === "up" || name === "down") travel(ui, name, data)
      else if (name === "return" || name === "enter") openBarItem(ui, data, ui.state.focusedSection)
      else if (name === "escape") ui.setState({ focusedSection: TAB_DEFAULT_FOCUS[ui.state.activeTab] })
    },
    hints: (state) => [
      { key: "←→", desc: "move" },
      { key: "enter", desc: state?.focusedSection === "bar.web" ? "open" : state?.focusedSection === "bar.sync" ? "sync" : state?.focusedSection === "bar.version" ? "check for updates" : "switch" },
      { key: "↓", desc: "page" },
      { key: "esc", desc: "done" },
    ],
  },
  "overview": {
    handle: handleOverview,
    list: true,
    hints: (state) => {
      if (state?.focusedSection === "ov.categories") return [
        { key: "j/k", desc: "move" },
        { key: "enter", desc: "transactions" },
        { key: "[ ]", desc: `prev/next ${state?.stepUnit ?? "range"}` },
        { key: "esc", desc: "done" },
      ]
      return [
        { key: "↑↓←→", desc: "panes" },
        ...(state && chartPaneOf(state.focusedSection) >= 0 ? [{ key: "enter", desc: "transactions" }] : []),
        { key: "h/l", desc: "chart" },
        { key: "d/D", desc: "range" },
        { key: "[ ]", desc: `prev/next ${state?.stepUnit ?? "range"}` },
        // On a Custom range, its dates are a key away.
        ...(state?.customRange ? [{ key: "C", desc: "edit dates", label: "Range: custom dates" }] : []),
        { key: "c", desc: "this cycle", label: "Range: this cycle" },
        { key: "a", desc: "account", label: "Next spending account" },
        { key: "i", desc: "review", command: "txn:uncategorised" },
        { key: "/", desc: "search", command: "txn:filter" },
        { key: "?", desc: "smart search", command: "txn:smart-search" },
        // Past the footer's eight: in the palette (the Custom chip shows too).
        ...(state?.customRange ? [] : [{ key: "C", desc: "custom range", label: "Range: custom dates" }]),
        ...(state?.overviewCharts !== 1 ? [{ key: "H/L", desc: "bottom chart" }] : []),
        { key: "0", desc: "now", label: "Range: back to now" },
        ...(state?.chartViews.slice(0, state.overviewCharts ?? 2).some((i) => CHART_VIEWS[i]?.group === "Balances") ? [{ key: "z", desc: "$0 axis" }] : []),
        { key: "v", desc: "jump" },
        { key: "1-4", desc: "tab" },
      ]
    },
  },
  "overview.range": {
    handle: handleOverviewRange,
    list: true,
    hints: (state) => [
      { key: "h/l", desc: "chip" },
      { key: "enter", desc: "apply" },
      { key: "[ ]", desc: `prev/next ${state?.stepUnit ?? "range"}` },
      { key: "esc", desc: "done" },
    ],
  },
  "manager.detail.notes": {
    handle: handleManagerDetailNotes,
    list: false,
    hints: () => [{ key: "type", desc: "notes" }, { key: "enter", desc: "save" }, { key: "esc", desc: "cancel" }],
  },
}


/** Every hint for a scope: the palette's commands; the footer shows
 * footerShown's cut of them. */
export function footerHints(scope: ScopeId, state?: HintState): Hint[] {
  return scopes[scope].hints(state)
}

/** What the footer shows in a scope: its hints, cut to the first few and
 * "ctrl+k all" where the palette opens. */
export function footerLine(scope: ScopeId, state?: HintState): Hint[] {
  return footerShown(footerHints(scope, state), scopes[scope].list)
}

/** The state the hints read, from both stores. */
/** H/L steps the Budgets tab's cycle pane, while one is on screen. */
const cycleChartHint = (state?: HintState) => ((state?.budgetCyclePanes ?? 1) > 0 ? [{ key: "H/L", desc: "cycle chart" }] : [])

export function hintState(ui: UiStore, data?: DataStore): HintState {
  return {
    focusedSection: ui.state.focusedSection,
    drillReturn: ui.state.drillReturn,
    chartViews: ui.state.chartViews,
    stepUnit: stepUnit(ui.state.timeframe),
    customRange: ui.state.timeframe.family === "custom",
    overviewCharts: ui.state.overviewCharts,
    budgetCyclePanes: ui.state.budgetCyclePanes,
    uncategorisedOnly: data?.state.uncategorisedOnly,
    tagReview: !!data?.state.tagReview,
    signInPaste: !!ui.state.llmSignIn?.paste,
    aiField: !!ui.state.aiDialog?.field,
    executorWaiting: !!ui.state.executor?.waiting,
    welcomeStep: ui.state.welcome?.step,
    welcomeTyping: !!ui.state.welcome && !ui.state.welcome.busy && !!data && welcomeRows(ui.state.welcome, welcomeContext(data)).some((r) => r.action === "token"),
    welcomeBusy: !!ui.state.welcome?.busy,
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

/** The budget cycle as editor draft fields. */
function cycleDraft(cycle: CycleConfig): { unit: CycleConfig["unit"]; anchor: CycleConfig["anchor"]; anchorDate: string; payEarly: boolean } {
  return { unit: cycle.unit, anchor: cycle.anchor, anchorDate: anchorDraft(cycle), payEarly: !!cycle.payEarly }
}

/** Show the next account in the accounts pane (the Transactions tab's `a`). */
function stepAccount(ui: UiStore, data: DataStore): void {
  const rows = accountRows(data.state.accounts)
  if (!rows.length) return
  const at = rows.findIndex((row) => row.selection === data.state.accountSelection)
  showAccount(ui, data, rows[(at + 1) % rows.length]!)
}
