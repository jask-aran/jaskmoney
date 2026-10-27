import { footerShown, type Hint } from "./palette"
import { commands, rankCommands, type Command } from "./commands"
import { ACCOUNT_ACTIONS, armedText, isArmed, isSecondPress, type Armed } from "../state/armed"
import { DATABASE_ROWS } from "../state/databaseRows"
import type { KeyEvent } from "@opentui/core"
import { resolve } from "node:path"
import { batch } from "solid-js"
import { accountRole } from "../domain/types"
import { accountRows, accountStacks, spendingScope, type AccountSelection } from "../domain/accountTree"
import { assignableCategories, pickerSuggestions } from "../domain/categoryOptions"
import { parseTagScope } from "../domain/tagScope"
import { tagChoices } from "../state/tagChooser"
import { RULE_AFTER } from "../domain/ruleOffers"
import { endTagReview, runTagAccept, startTagReview } from "./tagReview"
import { budgetLabel, budgetScopeOptions, scopeKey } from "../domain/budgetScopes"
import type { CycleConfig } from "../domain/budget"
import { MERCHANT_SORTS, groupByMerchant, merchantFilter, sortMerchantGroups } from "../domain/merchants"
import { anchorDraft, cycleFromDraft, editorFields, normaliseCycleDraft, pickerChoices, pickerItems, stepChoice } from "../state/settingsForm"
import { runSync } from "./sync"
import { runSmartSearch } from "./smartSearch"
import { runAsk } from "./ask"
import { askTerms } from "../domain/filter"
import { AI_ROWS, aiRowLabel, isLlmRow, testAi } from "./apiKeys"
import { aiActions, aiContext } from "../state/aiDialog"
import { cancelLlmSignIn, signOutLlm, startLlmSignIn, submitSignInPaste } from "./llmSignIn"
import { createLlm, hasLlm, LLM_PROVIDERS, llmModelId } from "../ai/llm"
import { credentialEnv } from "../ai/credentials"
import { runAccept, toggleUncategorised, newSuggestionsNote, suggestNew } from "./suggest"
import { ACCEPT_ALL_AT, MATCH_AT } from "../domain/questions"
import { CHART_VIEWS, JUMP_TARGETS, SETTINGS_SECTIONS, TABS, settingsSectionFocus, smartQuestionFor, type ScopeId, type UiState, type UiStore } from "../state/uiStore"
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
  customRange,
  stepCustom,
  stepPeriod,
  timeframeBounds,
  timeframeNow,
  type TimeframeState,
} from "../domain/timeframe"
import { editText, isPrintable, textField } from "../domain/textField"
import { appNow } from "../domain/days"
import { drillFilter } from "../domain/drill"
import type { CategoryLine } from "../domain/dashboard"
import { allCategoryLines, overviewRange } from "../state/overviewRange"
import { tagPickerItems, tagPickerState } from "../state/tagPicker"
import { savedFilterOptions } from "../state/savedFilters"
import { nextSavedFilterId } from "../state/settingsConfig"
import { theme } from "../theme"
import { count } from "../ui/text"


function defaultProfile(id: string, path: string) {
  const name = path.split(/[\\/]/).pop()?.replace(/\.csv$/i, "") || "CSV import"
  return { id, name, account: "", accountType: "debit" as const, importPrefix: name.toLowerCase(), hasHeader: true, delimiter: ",", dateColumn: 0, amountColumn: 1, descriptionColumns: [2], descriptionJoin: false, amountStrip: "$", dateFormat: "DMY" as const }
}

function moveTxnCursor(
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
    const anchorId =
      ui.state.rangeSelecting && ui.state.rangeAnchorId
        ? ui.state.rangeAnchorId
        : (prev?.id ?? cur.id)
    ui.setRangeFromMove(anchorId, cur.id, true)
  } else if (ui.state.rangeSelecting) {
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
  const step = key.name === "down" || (key.ctrl && (key.name === "n" || key.name === "j")) ? 1 : key.name === "up" || (key.ctrl && (key.name === "p" || key.name === "k")) ? -1 : 0
  if (step) { actions.update({ ...picker, cursor: Math.max(0, Math.min(length - 1, picker.cursor + step)) }); return }
  if (key.name === "return" || key.name === "enter") { actions.apply(); return }
  if (key.name === "backspace") { actions.update({ query: picker.query.slice(0, -1), cursor: 0 }); return }
  if (isPrintable(key)) actions.update({ query: picker.query + key.sequence, cursor: 0 })
}

/** List indices remain zero for empty lists. Callers include any extra create row. */
export function listMove(key: Pick<KeyEvent, "name" | "sequence" | "shift">, cursor: number, length: number): number | null {
  const last = Math.max(0, length - 1)
  let next: number
  if (key.sequence === "G" || (key.name === "g" && key.shift)) next = last
  else if (key.name === "g") next = 0
  else if (key.name === "j" || key.name === "down") next = cursor + 1
  else if (key.name === "k" || key.name === "up") next = cursor - 1
  else return null
  return Math.max(0, Math.min(last, next))
}

function reportError(ui: UiStore, error: unknown): void {
  ui.setStatus(error instanceof Error ? error.message : String(error), true)
}

function resetTransactionCursors(ui: UiStore, data?: DataStore): void {
  ui.jumpManagerCursor(0, data?.scopedTransactions().length ?? 0)
  ui.setState({ merchantCursor: 0, merchantTop: 0 })
}

/** Scopes whose printable keys are text, so a paste can type into them. */
const PASTE_SCOPES = new Set<ScopeId>(["llmSignIn", "settings.aiDialog", "filter", "manager.detail.notes", "catPicker", "tagPicker", "filterPicker", "settings.import.path", "settings.factoryReset"])

/** Whether a paste would land as text where input is now: never where
 * letters are commands (a pasted "x" must not dismiss anything). */
function pasteTarget(ui: UiStore, data?: DataStore): boolean {
  const scope = ui.activeScope()
  if (scope !== "settings.editor") return PASTE_SCOPES.has(scope)
  const kind = ui.state.settingsEditor
  if (!kind) return false
  if (ui.state.formPicker) return true
  const ctx = { accounts: data?.state.accounts ?? [], categories: data?.state.categories ?? [], tags: data?.state.tags ?? [], savedFilters: data?.state.savedFilters ?? [] }
  const fields = editorFields(kind, ui.state.settingsDraft, ctx)
  const field = fields[Math.min(ui.state.settingsEditField, fields.length - 1)]
  return field?.kind === "text"
}

/** Type pasted text into the focused text field, one character at a time
 * (one line: breaks become spaces, control characters are dropped, and the
 * ends are trimmed: a copied key often brings a newline).
 * Returns whether it landed. */
export function handlePaste(ui: UiStore, text: string, data?: DataStore): boolean {
  if (!pasteTarget(ui, data)) return false
  const line = text.replace(/[\r\n\t]+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "").trim()
  batch(() => {
    for (const ch of line) handleKey(ui, { name: ch === " " ? "space" : ch, sequence: ch, ctrl: false, meta: false, shift: false, option: false } as KeyEvent, data)
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
    if (name === "escape") { ui.setStatus("Cancelled"); return true }
    if (ui.state.status === armedText(armed)) ui.setStatus("")
  }
  const scope = ui.activeScope()
  const entry = scopes[scope]
  if (entry.quits) {
    if (key.ctrl && name === "k") { ui.setState({ palette: { query: "", cursor: 0, from: scope } }); return true }
    if (name === "v") {
      if (JUMP_TARGETS[ui.state.activeTab].length) ui.enterJump()
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
  const ctx = { ui, data, from: palette.from, press: (event: KeyEvent) => { handleKey(ui, event, data) } }
  return rankCommands(commands(ctx, footerHints(palette.from, hintState(ui, data))), palette.query, ui.state.lastCommandId)
}

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
      if (filter && data) {
        const result = data.commitFilter(filter.expr)
        if (!result.ok) { ui.setStatus(result.err, true); return }
        resetTransactionCursors(ui, data)
        ui.setState({ filterPicker: null })
        try { data.recordFilterUsage(filter.id); ui.setStatus(`Filter: ${filter.name}`) }
        catch (error) { reportError(ui, error) }
        void runAsk(ui, data)
      }
    },
  })
}

function handleDryRun(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  if (name === "escape") ui.setState({ dryRunReport: null, dryRunScroll: 0 })
  if (name === "j" || name === "down") {
    const lines = ui.state.dryRunReport?.rules.reduce((n, result) => n + 4 + result.samples.length, 0) ?? 0
    ui.setState({ dryRunScroll: Math.min(Math.max(0, lines - ui.state.dryRunVisible), ui.state.dryRunScroll + 1) })
  }
  if (name === "k" || name === "up") ui.setState({ dryRunScroll: Math.max(0, ui.state.dryRunScroll - 1) })
}

function handleJump(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name, sequence: seq } = key
  if (name === "escape" || name === "v") {
    ui.cancelJump()
    return
  }
  const hit = JUMP_TARGETS[ui.state.activeTab].find(
    (t) => t.key === name || t.key === seq,
  )
  if (hit) {
    if (ui.state.activeTab === "settings") {
      if (hit.section === "set.categories") ui.activateSettings("taxonomy", "categories", true)
      else if (hit.section === "set.tags") ui.activateSettings("taxonomy", "tags", true)
      else if (hit.section === "set.rules") ui.activateSettings("rules")
      else if (hit.section === "set.filters") ui.activateSettings("filters")
      else if (hit.section === "set.database") ui.activateSettings("database")
      else if (hit.section === "set.up") ui.activateSettings("up")
      else if (hit.section === "set.ai") ui.activateSettings("ai")
      else if (hit.section === "set.budgets") ui.activateSettings("budgets")
      return
    }
    ui.applyJump(hit.section)
    return
  }
}

function handleTagPicker(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  if (ui.state.tagPickerApplying) return
  const items = pickerChoices(tagPickerItems(data?.state.tags ?? [], data?.transactions() ?? [], ui.state.pickerTargets, ui.state.tagPickerQuery))
  queryPickerKey(key, { query: ui.state.tagPickerQuery, cursor: ui.state.tagPickerCursor }, items.length, {
    close: () => { ui.closeTagPicker(); ui.setStatus("Tags unchanged") },
    update: (next) => { ui.setState({ tagPickerQuery: next.query, tagPickerCursor: next.cursor }) },
    apply: () => {
      const targets = [...ui.state.pickerTargets]
      const patch = { ...ui.state.tagPickerPatch }
      try {
        if (items[ui.state.tagPickerCursor]?.value === null && data) {
          const id = data.createSettingsTag({ name: ui.state.tagPickerQuery.trim(), color: theme.blue, scope: null })
          patch[id] = "add"
          ui.setState({ tagPickerPatch: patch })
        }
        // Approved deviation from Go: enter without staged changes makes no edit.
        if (!data || !Object.keys(patch).length) {
          ui.closeTagPicker()
          ui.setStatus("Tags unchanged")
        } else {
          ui.setState({ tagPickerApplying: true })
          data.applyTagPatch(targets, patch).then(
            (summary) => { ui.closeTagPicker(); ui.setStatus(summary, summary.includes(" failed: ")) },
            (error) => { ui.closeTagPicker(); reportError(ui, error) },
          )
        }
      } catch (error) {
        reportError(ui, error)
      }
    },
    space: () => {
      const item = items[ui.state.tagPickerCursor]
      const targets = ui.state.pickerTargets
      if (item && typeof item.value === "number" && data && targets.length) {
        const id = item.value
        const base = tagPickerState(data.transactions(), targets, id)
        const patch = { ...ui.state.tagPickerPatch }
        const current = patch[id]
        // Approved deviation from Go: mixed tags cycle back to their original state.
        if (base === "some") {
          if (!current) patch[id] = "add"
          else if (current === "add") patch[id] = "remove"
          else delete patch[id]
        } else if (current) delete patch[id]
        else patch[id] = base === "all" ? "remove" : "add"
        ui.setState({ tagPickerPatch: patch })
      }
    },
  })
}

/** T: choose a tag (or a group found in the history, or a new name) to
 * find transactions for. */
function handleTagChooser(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const choices = data ? tagChoices(data.state.tags, data.tagGroups(), ui.state.tagChooserQuery) : []
  queryPickerKey(key, { query: ui.state.tagChooserQuery, cursor: ui.state.tagChooserCursor }, choices.length, {
    close: () => { ui.setState({ tagChooserOpen: false, tagChooserQuery: "", tagChooserCursor: 0 }); ui.setStatus("Transactions") },
    update: (next) => { ui.setState({ tagChooserQuery: next.query, tagChooserCursor: next.cursor }) },
    apply: () => {
      const choice = choices[ui.state.tagChooserCursor]
      ui.setState({ tagChooserOpen: false, tagChooserQuery: "", tagChooserCursor: 0 })
      if (choice && data) void startTagReview(ui, data, choice)
    },
  })
}

function openCategoryPicker(ui: UiStore, ids: number[], data?: DataStore): void {
  ui.openCatPicker(ids)
  const repeat = data?.lastRepeat()
  if (!data || repeat?.kind !== "category" || ui.state.catPickerQuery || ids.some((id) => data.state.suggestions[id])) return
  // Start on the last category chosen (the list keeps its order).
  const cursor = assignableCategories(data.state.categories, "", pickerSuggestions(ids, data.state.suggestions)).findIndex((c) => c.id === repeat.categoryId)
  if (cursor >= 0) ui.setState({ catPickerCursor: cursor })
}

function handleCatPicker(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const cats = assignableCategories(data?.state.categories ?? [], ui.state.catPickerQuery, pickerSuggestions(ui.state.pickerTargets, data?.state.suggestions ?? {}))
  queryPickerKey(key, { query: ui.state.catPickerQuery, cursor: ui.state.catPickerCursor }, cats.length, {
    close: () => { ui.closeCatPicker(); ui.setStatus("Categorize cancelled") },
    update: (next) => { ui.setState({ catPickerQuery: next.query, catPickerCursor: next.cursor }) },
    apply: () => {
      const cat = cats[ui.state.catPickerCursor]
      // Targets were fixed when the picker opened (the Transactions
      // selection or cursor row, the open detail row, or a merchant group).
      const targets = ui.state.pickerTargets
      if (cat && data && targets.length) {
        ui.closeCatPicker()
        ui.setStatus(`Categorizing ${targets.length} → ${cat.name}…`)
        let resuggest: Promise<string> | undefined
        data.categorizeTransactions(targets, cat.id, (pushed, total) => {
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
  // ↑ on a smart search's filter brings its question back, to reword it.
  const question = smartQuestionFor(ui.state, ui.state.filterDraft)
  if (name === "up" && question) {
    const draft = `?${question}`
    ui.setState({ filterDraft: draft, filterCaret: draft.length })
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
    const draft = ui.state.filterDraft
    // ?<query>: ask the models for a filter; the draft stays open with it.
    if (draft.trimStart().startsWith("?")) {
      if (data) void runSmartSearch(ui, data, draft, () => resetTransactionCursors(ui, data))
      return
    }
    ui.closeFilter(true)
    const r = data?.commitFilter(draft) ?? { ok: true, err: "" }
    resetTransactionCursors(ui, data)
    if (!draft.trim()) {
      ui.setStatus("Filter cleared")
    } else if (r.ok) {
      ui.setStatus(`Filter ok · ${data?.scopedTransactions().length ?? 0} rows`)
    } else {
      ui.setStatus(`Filter live (not strict): ${r.err}`, true)
    }
    if (data && r.ok) void runAsk(ui, data)
    return
  }
  const next = editText({ value: ui.state.filterDraft, caret: ui.state.filterCaret }, key)
  if (next) {
    ui.setState({ filterDraft: next.value, filterCaret: next.caret })
    // A smart search is plain English until enter asks for its filter.
    if (next.value.trimStart().startsWith("?")) return
    data?.setFilterLive(next.value)
    resetTransactionCursors(ui, data)
  }
}

function handleManagerDetailNotes(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  if (ui.state.detailId == null) return
  const { name } = key
  if (name === "escape") { ui.setState({ detailNotesEditing: false, detailNotesDraft: "", detailNotesCaret: 0 }); ui.setStatus("Notes unchanged"); return }
  if (name === "return" || name === "enter") {
    try { data?.updateTransactionNotes(ui.state.detailId, ui.state.detailNotesDraft.trim()); ui.setStatus("Notes saved") } catch (e) { reportError(ui, e) }
    ui.setState({ detailNotesEditing: false, detailNotesDraft: "", detailNotesCaret: 0 })
    return
  }
  const next = editText({ value: ui.state.detailNotesDraft, caret: ui.state.detailNotesCaret }, key)
  if (next) ui.setState({ detailNotesDraft: next.value, detailNotesCaret: next.caret })
}

function handleManagerDetail(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key

  if (name === "escape" || name === "return" || name === "enter") { ui.setState({ detailId: null }); return }
  if (name === "c") { openCategoryPicker(ui, ui.targetIds(data?.scopedTransactions() ?? []), data); return }
  if (name === "t") { ui.openTagPicker(ui.targetIds(data?.scopedTransactions() ?? [])); return }
  if (name === "n") {
    const notes = data?.transactions().find((t) => t.id === ui.state.detailId)?.notes ?? ""
    ui.setState({ detailNotesEditing: true, detailNotesDraft: notes, detailNotesCaret: notes.length })
    return
  }
  // j/k browse neighbouring transactions without closing the view.
  if (name === "j" || name === "down" || name === "k" || name === "up") {
    const rows = data?.scopedTransactions() ?? []
    moveTxnCursor(ui, data, name === "j" || name === "down" ? 1 : -1, false)
    const row = rows[ui.state.managerCursor]
    if (row) ui.setState({ detailId: row.id })
    return
  }
}

function handleOverviewCustom(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  const edit = ui.state.customEdit
  if (!edit) return
  if (name === "escape") { ui.setState({ customEdit: null }); ui.setStatus("Range unchanged"); return }
  if (name === "tab" || name === "up" || name === "down") {
    const field: 0 | 1 = edit.field === 0 ? 1 : 0
    ui.setState({ customEdit: { ...edit, field, [field === 0 ? "start" : "end"]: textField((field === 0 ? edit.start : edit.end).value) } })
    return
  }
  if (name === "return" || name === "enter") {
    const range = customRange(edit.start.value.trim(), edit.end.value.trim())
    if (typeof range === "string") { ui.setState({ customEdit: { ...edit, error: range } }); return }
    const tf: TimeframeState = { ...ui.state.timeframe, family: "custom", custom: range }
    ui.setTimeframe(tf)
    ui.setState({ customEdit: null })
    ui.setDashChipCursor(CUSTOM_CHIP)
    ui.setStatus(`Custom · ${timeframeBounds(tf, appNow()).label}`)
    return
  }
  const key2 = edit.field === 0 ? "start" : "end"
  const next = editText(edit[key2], key)
  if (next) ui.setState({ customEdit: { ...edit, [key2]: next, error: "" } })
}

function handleSettingsFactoryReset(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  if (name === "escape") { ui.setState({ factoryResetOpen: false, factoryResetDraft: "", factoryResetCaret: 0 }); ui.setStatus("Factory reset cancelled"); return }
  if (name === "return" || name === "enter") {
    if (ui.state.factoryResetDraft !== "RESET") { ui.setStatus("Type RESET exactly to erase this database", true); return }
    try { data?.factoryResetDatabase(); ui.setState({ factoryResetOpen: false, factoryResetDraft: "", factoryResetCaret: 0 }); ui.setStatus("Database reset · OpenTUI settings retained") } catch (e) { reportError(ui, e) }
    return
  }
  const next = editText({ value: ui.state.factoryResetDraft, caret: ui.state.factoryResetCaret }, key)
  if (next) ui.setState({ factoryResetDraft: next.value, factoryResetCaret: next.caret })
}

function handleManagerAccountAction(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  if (name === "escape") { ui.setState({ accountActionId: null }); ui.setStatus("Account actions cancelled"); return }
  const account = data?.state.accounts.find((a) => a.id === ui.state.accountActionId)
  const moved = listMove(key, ui.state.accountActionCursor, ACCOUNT_ACTIONS.length)
  if (moved != null) { ui.setState({ accountActionCursor: moved }); return }
  if ((name === "return" || name === "enter") && account) {
    const kind = ACCOUNT_ACTIONS[ui.state.accountActionCursor]!
    const done = ui.state.armed && isArmed(ui.state.armed, kind, account.id)
    confirmTwice(ui, data, { kind, id: account.id, label: account.name, with: "enter" })
    if (done) ui.setState({ accountActionId: null })
  }
}

/** del (or enter) twice (state/armed): the first press arms the row, the
 * same key on it again does it; handleKey disarms on any other key. */
function confirmTwice(ui: UiStore, data: DataStore | undefined, armed: Armed): void {
  const now = ui.state.armed
  if (now && isArmed(now, armed.kind, armed.id) && now.with === armed.with) {
    ui.disarm()
    try { ui.setStatus(CONFIRMED[armed.kind](data, armed)) } catch (e) { reportError(ui, e) }
    return
  }
  ui.arm(armed)
  ui.setStatus(armedText(armed))
}

type Confirm = Armed

/** What each armed row does on its second press, and the status it leaves. */
const CONFIRMED: Record<Confirm["kind"], (data: DataStore | undefined, c: Confirm) => string> = {
  category: (data, c) => { data?.deleteSettingsCategory(Number(c.id)); return `Deleted ${c.label}` },
  tag: (data, c) => { data?.deleteSettingsTag(Number(c.id)); return `Deleted ${c.label}` },
  rule: (data, c) => { data?.deleteSettingsRule(Number(c.id)); return `Deleted ${c.label}` },
  filter: (data, c) => { data?.deleteSavedFilter(String(c.id)); return `Deleted ${c.label}` },
  profile: (data, c) => { data?.deleteImportProfile(String(c.id)); return `Deleted ${c.label}` },
  budget: (data, c) => { data?.removeBudget(Number(c.id)); return `Deleted ${c.label}` },
  clearData: (data) => { data?.clearDatabaseData(); return "Transaction and import data cleared" },
  clearAccount: (data, c) => { data?.clearAccountData(Number(c.id)); return `Cleared ${c.label}` },
  deleteAccount: (data, c) => { data?.removeAccountData(Number(c.id)); return `Removed ${c.label}` },


  desyncAccount: (data, c) => `Sync off for ${c.label} · ${data?.setAccountSync(Number(c.id), false) ?? 0} transactions removed`,
}

function handleSettingsEditor(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  const kind = ui.state.settingsEditor
  if (!kind) return
  const draft = ui.state.settingsDraft
  const ctx = { accounts: data?.state.accounts ?? [], categories: data?.state.categories ?? [], tags: data?.state.tags ?? [], savedFilters: data?.state.savedFilters ?? [] }
  const fields = editorFields(kind, draft, ctx)
  const fieldIndex = Math.min(ui.state.settingsEditField, fields.length - 1)
  const field = fields[fieldIndex]!

  // A picker field's list owns input until it closes (like the category
  // picker: arrows move, printable keys filter).
  const picker = ui.state.formPicker
  if (picker) {
    const choices = pickerChoices(pickerItems(kind, field.key, ctx, picker.query))
    queryPickerKey(key, picker, choices.length, {
      close: () => ui.setState({ formPicker: null }),
      update: (next) => ui.setState({ formPicker: next }),
      apply: () => {
        const choice = choices[picker.cursor]
        if (!choice) return
        if (field.multi) {
          // Multi-choice (rule tags): enter toggles; esc closes.
          const id = Number(choice.value)
          ui.setState("settingsDraft", "addTagIds", draft.addTagIds.includes(id) ? draft.addTagIds.filter((t) => t !== id) : [...draft.addTagIds, id])
          return
        }
        ui.setState("settingsDraft", field.key as "scopeKey", choice.value as never)
        ui.setState({ formPicker: null })
      },
    })
    return
  }

  const isText = field.kind === "text"
  const move = (step: number) => {
    const next = (fieldIndex + step + fields.length) % fields.length
    const field = fields[next]!
    ui.setState({ settingsEditField: next, settingsCaret: field.kind === "text" ? field.display.length : 0 })
  }
  if (name === "escape") { ui.closeSettingsEditor(); ui.setStatus("Edit cancelled"); return }
  if (name === "tab") { move(key.shift ? -1 : 1); return }
  if (name === "down" || (!isText && name === "j")) { move(1); return }
  if (name === "up" || (!isText && name === "k")) { move(-1); return }
  if ((name === "return" || name === "enter") && field.kind === "picker") {
    // Open the list on the current value.
    const current = draft[field.key]
    const at = field.multi ? 0 : pickerChoices(pickerItems(kind, field.key, ctx, "")).findIndex((c) => c.value === current)
    ui.setState({ formPicker: { query: "", cursor: Math.max(0, at) } })
    return
  }
  if (name === "return" || name === "enter") {
    try {
      if (kind === "category") {
        if (ui.state.settingsEditId == null) data?.createSettingsCategory({ name: draft.name, color: draft.color, notSpending: draft.notSpending })
        else data?.updateSettingsCategory(Number(ui.state.settingsEditId), { name: draft.name, color: draft.color, notSpending: draft.notSpending })
      } else if (kind === "tag") {
        const scope = draft.expr.trim()
        const { error } = parseTagScope(scope)
        if (error) throw new Error(`scope: ${error}`)
        if (ui.state.settingsEditId == null) data?.createSettingsTag({ name: draft.name, color: draft.color, scope: scope || null })
        else data?.updateSettingsTag(Number(ui.state.settingsEditId), { name: draft.name, color: draft.color, scope: scope || null })
      } else if (kind === "budget") {
        const option = budgetScopeOptions(ctx.accounts, ctx.categories).find((o) => o.key === draft.scopeKey)
        const amount = Number(draft.amount.replace(/[$,\s]/g, ""))
        if (!option) throw new Error("choose what the budget covers")
        if (!draft.amount.trim() || !Number.isFinite(amount)) throw new Error("enter the budget amount")
        const cycle = cycleFromDraft(draft)
        if (typeof cycle === "string") throw new Error(cycle)
        const current = data?.state.budgetCycle
        // The cycle is shared by every budget; save it first so a bad date
        // stops the whole edit.
        if (current && (current.unit !== cycle.unit || current.anchor !== cycle.anchor || current.anchorDate !== cycle.anchorDate || !!current.payEarly !== !!cycle.payEarly)) data?.setBudgetCycle(cycle)
        const editing = data?.state.budgets.find((b) => b.id === ui.state.settingsEditId)
        if (editing && scopeKey(editing.scope) !== option.key) data?.removeBudget(editing.id)
        data?.setBudget(option.scope, amount)
      } else if (kind === "cycle") {
        const cycle = cycleFromDraft(draft)
        if (typeof cycle === "string") throw new Error(cycle)
        data?.setBudgetCycle(cycle)
      } else if (kind === "filter") {
        data?.saveSavedFilter({ id: draft.id, name: draft.name, expr: draft.expr }, typeof ui.state.settingsEditId === "string" ? ui.state.settingsEditId : undefined)
      } else {
        const existing = data?.state.rules.find((r) => r.id === ui.state.settingsEditId)
        const rule = { id: Number(ui.state.settingsEditId ?? 0), name: draft.name, savedFilterId: draft.savedFilterId, setCategoryId: draft.setCategoryId, addTagIds: draft.addTagIds, enabled: existing?.enabled ?? true, sortOrder: existing?.sortOrder ?? 0 }
        if (ui.state.settingsEditId == null) data?.createSettingsRule(rule)
        else data?.updateSettingsRule(rule)
      }
      ui.closeSettingsEditor(); ui.setStatus("Saved")
    } catch (e) { reportError(ui, e) }
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
    const next = editText({ value: field.display, caret: ui.state.settingsCaret }, key)
    if (next) {
      ui.setState("settingsDraft", field.key as "name", next.value)
      ui.setState({ settingsCaret: next.caret })
    }
  }
}

function handleSettingsImportFiles(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  const files = ui.state.importFiles
  if (name === "escape") { ui.cancelImport(); ui.setStatus("Import cancelled"); return }
  const moved = listMove(key, ui.state.importCursor, files.length)
  if (moved != null) { ui.setState({ importCursor: moved }); return }
  if (name === "/" || name === "p") { ui.setState({ importStage: "path", importPath: "", importPathCaret: 0 }); return }
  if ((name === "return" || name === "enter") && files[ui.state.importCursor]) {
    const path = files[ui.state.importCursor]!
    const matches = data?.profileMatches(path) ?? []
    if (matches.length === 1) { try { const preview = data?.previewImport(path, matches[0]!); ui.setState({ importStage: "preview", importPath: path, importPathCaret: path.length, importPreview: preview ?? null }) } catch (e) { reportError(ui, e) } }
    else ui.setState({ importStage: "profile", importPath: path, importPathCaret: path.length, importProfileCursor: 0 })
    return
  }
}

function handleSettingsImportPath(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  if (name === "escape") { ui.setState({ importStage: "files", importPath: "", importPathCaret: 0 }); return }
  if (name === "return" || name === "enter") {
    const raw = ui.state.importPath.trim()
    if (!raw) { ui.setStatus("Enter a CSV path", true); return }
    const path = resolve(ui.state.importDirectory, raw)
    try {
      const matches = data?.profileMatches(path) ?? []
      if (matches.length === 1) ui.setState({ importStage: "preview", importPath: path, importPathCaret: path.length, importPreview: data?.previewImport(path, matches[0]!) ?? null })
      else ui.setState({ importStage: "profile", importPath: path, importPathCaret: path.length, importProfileCursor: 0 })
    } catch (e) { reportError(ui, e) }
    return
  }
  const next = editText({ value: ui.state.importPath, caret: ui.state.importPathCaret }, key)
  if (next) ui.setState({ importPath: next.value, importPathCaret: next.caret })
}

function handleSettingsImportProfile(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  const profiles = data?.state.importProfiles ?? []
  if (name === "escape") { ui.setState({ importStage: ui.state.importProfileManaging ? "none" : "files", importProfileManaging: false }); return }
  const moved = listMove(key, ui.state.importProfileCursor, profiles.length + 1)
  if (moved != null) { ui.setState({ importProfileCursor: moved }); return }
  if (name === "a" || name === "n" || (name === "return" || name === "enter") && ui.state.importProfileCursor === profiles.length) { ui.openProfileEditor(defaultProfile(`profile-${profiles.length + 1}`, ui.state.importPath), null); return }
  if (name === "e" && profiles[ui.state.importProfileCursor]) { ui.openProfileEditor(profiles[ui.state.importProfileCursor]!, profiles[ui.state.importProfileCursor]!.id); return }
  if (name === "delete" && profiles[ui.state.importProfileCursor]) { const selected = profiles[ui.state.importProfileCursor]!; confirmTwice(ui, data, { kind: "profile", id: selected.id, label: selected.name, with: "delete" }); return }
  if ((name === "return" || name === "enter") && profiles[ui.state.importProfileCursor]) {
    if (ui.state.importProfileManaging) { ui.openProfileEditor(profiles[ui.state.importProfileCursor]!, profiles[ui.state.importProfileCursor]!.id); return }
    try { ui.setState({ importStage: "preview", importPreview: data?.previewImport(ui.state.importPath, profiles[ui.state.importProfileCursor]!) ?? null }) } catch (e) { reportError(ui, e) }
    return
  }
}

function handleSettingsImportProfileEditor(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  const draft = ui.state.importProfileDraft, field = ui.state.importProfileField
  const fields = ["id", "name", "account", "accountType", "importPrefix", "hasHeader", "delimiter", "dateColumn", "amountColumn", "descriptionColumns", "descriptionJoin", "amountStrip", "dateFormat"] as const
  const selected = fields[field]!
  if (name === "escape") { ui.setState({ importStage: "profile" }); return }
  if (name === "tab") {
    const next = (field + (key.shift ? -1 : 1) + fields.length) % fields.length
    const selected = fields[next]!
    const value = selected === "descriptionColumns" ? draft.descriptionColumns.join(",") : String(draft[selected])
    ui.setState({ importProfileField: next, importProfileCaret: value.length })
    return
  }
  if (name === "return" || name === "enter") {
    try {
      data?.saveImportProfile(draft, ui.state.importProfileEditId)
      const preview = ui.state.importPath ? data?.previewImport(ui.state.importPath, draft) : null
      ui.setState({ importStage: preview ? "preview" : "profile", importPreview: preview ?? null, importProfileEditId: null })
      ui.setStatus(`Saved profile ${draft.name}`)
    } catch (e) { reportError(ui, e) }
    return
  }
  if (selected === "accountType" && (name === "h" || name === "left" || name === "l" || name === "right" || name === "space")) { ui.setState("importProfileDraft", "accountType", draft.accountType === "debit" ? "credit" : "debit"); return }
  if ((selected === "hasHeader" || selected === "descriptionJoin") && (name === "h" || name === "left" || name === "l" || name === "right" || name === "space")) { ui.setState("importProfileDraft", selected, !draft[selected]); return }
  if (selected === "dateFormat" && (name === "h" || name === "left" || name === "l" || name === "right" || name === "space")) { const values = ["DMY", "MDY", "YMD"] as const; ui.setState("importProfileDraft", "dateFormat", values[(values.indexOf(draft.dateFormat) + 1) % values.length]!); return }
  if (selected === "accountType" || selected === "hasHeader" || selected === "descriptionJoin" || selected === "dateFormat") return
  const text = selected === "descriptionColumns" ? draft.descriptionColumns.join(",") : String(draft[selected])
  const next = editText({ value: text, caret: ui.state.importProfileCaret }, key)
  if (next) {
    ui.setState({ importProfileCaret: next.caret })
    if (selected === "descriptionColumns") ui.setState("importProfileDraft", selected, next.value ? next.value.split(",").map(Number).filter(Number.isInteger) : [])
    else if (selected === "dateColumn" || selected === "amountColumn") ui.setState("importProfileDraft", selected, Number(next.value || 0))
    else ui.setState("importProfileDraft", selected, next.value)
  }
}

function handleSettingsImportPreview(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  const preview = ui.state.importPreview
  const rows = preview ? (ui.state.importPreviewShowAll ? preview.rows : preview.rows.filter((row) => row.duplicate)) : []
  if (name === "escape") { ui.cancelImport(); ui.setStatus("Import cancelled"); return }
  const moved = listMove(key, ui.state.importPreviewCursor, rows.length)
  if (moved != null) { ui.setState({ importPreviewCursor: moved }); return }
  if (name === "p") { ui.setState({ importPreviewShowAll: !ui.state.importPreviewShowAll, importPreviewCursor: 0 }); return }
  if (name === "r") { ui.setState({ importPreviewRules: !ui.state.importPreviewRules }); return }
  if ((name === "s" || name === "a") && preview) {
    try {
      const summary = data?.commitPreview({ ...preview, rulesEnabled: ui.state.importPreviewRules }, name === "s") ?? "Import unavailable"
      ui.cancelImport()
      ui.setStatus(summary)
      // The new rows get suggestions in the background.
      if (data) void suggestNew(data).then((n) => { if (n) ui.setStatus(summary + newSuggestionsNote(n)) })
    } catch (e) { reportError(ui, e) }
    return
  }
}

function handleSettings(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  if (name === "i") {
    try {
      const directory = data?.importDirectory() ?? process.cwd()
      ui.activateSettings("database")
      ui.beginImport(directory, data?.csvFiles(directory) ?? [])
    } catch (e) { reportError(ui, e) }
    return
  }
  const sections = SETTINGS_SECTIONS
  const current = ui.state.settingsSection
  if (name === "h" || name === "left") { ui.setState({ settingsSection: "taxonomy", focusedSection: "set.categories" }); return }
  if (name === "l" || name === "right") { ui.setState({ settingsSection: "database", focusedSection: "set.database" }); return }
  if (name === "j" || name === "down" || name === "k" || name === "up") {
    const delta = name === "j" || name === "down" ? 1 : -1
    const next = sections[(sections.indexOf(current) + delta + sections.length) % sections.length]!
    ui.setState({ settingsSection: next, focusedSection: settingsSectionFocus(next) })
    return
  }
  if (name === "return" || name === "enter") { ui.activateSettings(current); return }
}

function handleSettingsTaxonomy(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  const list = ui.state.taxonomyList
  const items = list === "categories" ? data?.state.categories ?? [] : data?.state.tags ?? []
  const cursor = list === "categories" ? ui.state.categoryCursor : ui.state.tagCursor
  if (name === "escape") { ui.leaveSettings(); return }
  if (name === "h" || name === "left" || name === "l" || name === "right") { ui.activateSettings("taxonomy", list === "categories" ? "tags" : "categories"); return }
  const moved = listMove(key, cursor, items.length)
  if (moved != null) { ui.moveSettingsList(list, moved - cursor, items.length); return }
  if (name === "pageup") { ui.moveSettingsList(list, -10, items.length); return }
  if (name === "pagedown") { ui.moveSettingsList(list, 10, items.length); return }
  if (name === "a") {
    ui.openSettingsEditor(list === "categories" ? "category" : "tag", null, { ...ui.state.settingsDraft, name: "", color: list === "categories" ? "#94e2d5" : "#89b4fa", expr: "", notSpending: false })
    return
  }
  if ((name === "return" || name === "enter") && items[cursor]) {
    const item = items[cursor]!
    ui.openSettingsEditor(list === "categories" ? "category" : "tag", item.id, { ...ui.state.settingsDraft, name: item.name, color: item.color, expr: "scope" in item ? item.scope ?? "" : "", notSpending: "notSpending" in item ? item.notSpending : false })
    return
  }
  if (name === "delete" && items[cursor]) { confirmTwice(ui, data, { kind: list === "categories" ? "category" : "tag", id: items[cursor]!.id, label: items[cursor]!.name, with: "delete" }); return }
}

function handleSettingsRules(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name, sequence: seq } = key
  const rules = data?.state.rules ?? []; const cursor = ui.state.ruleCursor; const rule = rules[cursor]
  if (name === "escape") { ui.leaveSettings(); return }
  if (((seq === "J") || (name === "j" && key.shift)) && rule) { data?.reorderSettingsRule(rule.id, cursor + 1); ui.setState({ ruleCursor: Math.min(rules.length - 1, cursor + 1) }); return }
  if (((seq === "K") || (name === "k" && key.shift)) && rule) { data?.reorderSettingsRule(rule.id, cursor - 1); ui.setState({ ruleCursor: Math.max(0, cursor - 1) }); return }
  if ((seq === "A" || (name === "a" && key.shift))) { const r = data?.applyRules(); ui.setStatus(r ? `Rules applied · ${r.updatedTransactions} transactions` : "No database"); return }
  if ((seq === "D" || (name === "d" && key.shift))) { const r = data?.dryRunRules(); if (r) ui.setState({ dryRunReport: r, dryRunScroll: 0 }); else ui.setStatus("No database"); return }
  const moved = listMove(key, ui.state.ruleCursor, rules.length)
  if (moved != null) { ui.setState({ ruleCursor: moved }); return }
  if (name === "a") { ui.openSettingsEditor("rule", null, { ...ui.state.settingsDraft, name: "", savedFilterId: data?.state.savedFilters[0]?.id ?? "", setCategoryId: null, addTagIds: [] }); return }
  if ((name === "return" || name === "enter") && rule) { ui.openSettingsEditor("rule", rule.id, { ...ui.state.settingsDraft, name: rule.name, savedFilterId: rule.savedFilterId, setCategoryId: rule.setCategoryId, addTagIds: rule.addTagIds }); return }
  if (name === "space" && rule) { data?.toggleSettingsRule(rule.id, !rule.enabled); return }
  if (name === "delete" && rule) { confirmTwice(ui, data, { kind: "rule", id: rule.id, label: rule.name, with: "delete" }); return }
}

function handleSettingsFilters(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  const filters = data?.state.savedFilters ?? []; const cursor = ui.state.filterCursor; const filter = filters[cursor]
  if (name === "escape") { ui.leaveSettings(); return }
  const moved = listMove(key, ui.state.filterCursor, filters.length)
  if (moved != null) { ui.setState({ filterCursor: moved }); return }
  if (name === "a") { const id = `filter-${filters.length + 1}`; ui.openSettingsEditor("filter", null, { ...ui.state.settingsDraft, id, name: "", expr: "" }); return }
  if ((name === "return" || name === "enter") && filter) { ui.openSettingsEditor("filter", filter.id, { ...ui.state.settingsDraft, id: filter.id, name: filter.name, expr: filter.expr }); return }
  if (name === "delete" && filter) { confirmTwice(ui, data, { kind: "filter", id: filter.id, label: filter.name, with: "delete" }); return }
}

function handleSettingsUp(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  const accounts = data?.state.syncAccounts ?? []
  const account = accounts[ui.state.upCursor]
  if (name === "escape") { ui.leaveSettings(); return }
  const moved = listMove(key, ui.state.upCursor, accounts.length)
  if (moved != null) { ui.setState({ upCursor: moved }); return }
  if ((name === "return" || name === "enter") && account && data) {
    // Switching off deletes the account's transactions: enter twice.
    if (account.syncEnabled) { confirmTwice(ui, data, { kind: "desyncAccount", id: account.id, label: account.name, with: "enter" }); return }
    try { data.setAccountSync(account.id, true); ui.setStatus(`Sync on for ${account.name} · s to sync now`) } catch (e) { reportError(ui, e) }
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
  const { name } = key
  const offers = data?.allRuleOffers() ?? []
  const close = () => ui.setState({ ruleOffersOpen: false, ruleOfferCursor: 0 })
  if (name === "escape") { close(); ui.setStatus("Transactions"); return }
  // The final action row asks the general model for more rules.
  if ((name === "return" || name === "enter") && ui.state.ruleOfferCursor === offers.length && hasLlm() && data) {
    if (data.state.writingRules) return
    ui.setStatus(`Asking ${llmModelId()} for rules…`)
    data.askForRules().then((summary) => ui.setStatus(summary), (e) => reportError(ui, e))
    return
  }
  const moved = listMove(key, ui.state.ruleOfferCursor, offers.length + (hasLlm() ? 1 : 0))
  if (moved != null) { ui.setState({ ruleOfferCursor: moved }); return }
  const offer = offers[ui.state.ruleOfferCursor]
  if (!offer || !data) return
  const settle = () => {
    const left = data.allRuleOffers().length + (hasLlm() ? 1 : 0)
    if (!left) close()
    else ui.setState({ ruleOfferCursor: Math.min(ui.state.ruleOfferCursor, left - 1) })
  }
  if (name === "return" || name === "enter") {
    ui.setStatus(`Making a rule for ${offer.description}…`)
    data.makeOfferedRule(offer).then(
      (summary) => { settle(); ui.jumpManagerCursor(Math.min(ui.state.managerCursor, Math.max(0, data.scopedTransactions().length - 1)), data.scopedTransactions().length); ui.setStatus(summary) },
      (e) => reportError(ui, e),
    )
    return
  }
  if (name === "x" && !key.shift) {
    data.declineRuleOffer(offer)
    settle()
    ui.setStatus(`No rule for ${offer.description}; it won't be offered again`)
  }
}

function handleSettingsAi(ui: UiStore, key: KeyEvent): void {
  const { name } = key
  if (name === "escape") { ui.leaveSettings(); return }
  const moved = listMove(key, ui.state.aiCursor, AI_ROWS.length)
  if (moved != null) { ui.setState({ aiCursor: moved }); return }
  if (name === "return" || name === "enter") ui.setState({ aiDialog: { row: AI_ROWS[ui.state.aiCursor] ?? "jev", cursor: 0, field: null, armed: false, note: null, busy: false } })
}

/** The AI models dialog: j/k pick an action, enter runs it; a field (key,
 * account id, model) takes typing and pasting until enter saves or esc
 * backs out; remove needs enter twice; esc closes. */
function handleAiDialog(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const dialog = ui.state.aiDialog
  if (!dialog || !data) return
  const { name } = key
  const row = dialog.row
  const note = (text: string, ok: boolean | null) => ui.setState("aiDialog", { note: { text, ok }, busy: false })
  if (dialog.field) {
    const field = dialog.field
    if (name === "escape") { ui.setState("aiDialog", { field: null }); return }
    if (name === "return" || name === "enter") {
      const value = field.value.trim()
      try {
        if (field.action === "key") {
          if (!value) { ui.setState("aiDialog", { field: null }); return }
          data.saveApiKeys(row === "jev" ? { JASKMONEY_JEV_TOKEN: value } : row === "workersAi" ? { JASKMONEY_CF_TOKEN: value } : { [LLM_PROVIDERS[row].keyName]: value })
          ui.setState("aiDialog", { field: null, note: { text: "Key saved", ok: true } })
        } else if (field.action === "accountId") {
          data.saveApiKeys({ JASKMONEY_CF_ACCOUNT_ID: value || null })
          ui.setState("aiDialog", { field: null, note: { text: value ? "Account ID saved" : "Account ID removed", ok: true } })
        } else if (isLlmRow(row)) {
          const { modelName, defaultModel } = LLM_PROVIDERS[row]
          // An id the provider doesn't have is refused; the default isn't saved, so it follows the app's.
          createLlm({ provider: row, apiKey: "x", modelId: value || defaultModel })
          data.saveApiKeys({ [modelName]: value && value !== defaultModel ? value : null, ...(row === "openrouter" ? { JASKMONEY_LLM_MODEL: null } : {}) })
          ui.setState("aiDialog", { field: null, note: { text: `Model: ${value || defaultModel}`, ok: true } })
        }
      } catch (e) {
        note(e instanceof Error ? e.message : String(e), false)
      }
      return
    }
    // A key is never shown, so edits apply at its end.
    const next = editText({ value: field.value, caret: field.action === "key" ? field.value.length : field.caret }, key)
    if (next) ui.setState("aiDialog", "field", { value: next.value, caret: next.caret })
    return
  }
  const ctx = aiContext(data)
  const actions = aiActions(row, ctx)
  if (name === "escape") { ui.setState({ aiDialog: null }); return }
  const moved = listMove(key, dialog.cursor, actions.length)
  if (moved != null) { ui.setState("aiDialog", { cursor: moved, armed: false }); return }
  if (name !== "return" && name !== "enter") return
  const action = actions[Math.min(dialog.cursor, actions.length - 1)]
  if (!action || dialog.busy) return
  const label = aiRowLabel(row)
  switch (action.id) {
    case "signIn":
      if (isLlmRow(row)) void startLlmSignIn(ui, data, row).then(() => note(ui.state.status, !ui.state.statusErr))
      return
    case "key":
    case "accountId":
    case "model": {
      const value = action.id === "model" && isLlmRow(row) ? llmModelId(credentialEnv(), row) : action.id === "accountId" ? (credentialEnv().JASKMONEY_CF_ACCOUNT_ID ?? "") : ""
      ui.setState("aiDialog", { field: { action: action.id, value, caret: value.length }, note: null })
      return
    }
    case "test":
      ui.setState("aiDialog", { busy: true, note: { text: "Testing…", ok: null } })
      void testAi(row).then((result) => note(result.text, result.ok))
      return
    case "use":
      if (!isLlmRow(row)) return
      data.saveApiKeys({ JASKMONEY_LLM_PROVIDER: row })
      note(`${label} now writes rules`, true)
      return
    case "remove": {
      if (!dialog.armed) { ui.setState("aiDialog", { armed: true, note: { text: "Press enter again to remove", ok: null } }); return }
      if (isLlmRow(row)) {
        const { keyName, modelName } = LLM_PROVIDERS[row]
        data.saveApiKeys({ [keyName]: null, [modelName]: null, ...(row === "openrouter" ? { JASKMONEY_LLM_MODEL: null } : {}) })
        void signOutLlm(data, row)
      } else data.saveApiKeys(row === "jev" ? { JASKMONEY_JEV_TOKEN: null } : { JASKMONEY_CF_TOKEN: null, JASKMONEY_CF_ACCOUNT_ID: null })
      ui.setState("aiDialog", { armed: false, cursor: 0, note: { text: `Removed what was saved for ${label}`, ok: true } })
      return
    }
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

function handleSettingsDatabase(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  if (name === "escape") { ui.leaveSettings(); return }
  const moved = listMove(key, ui.state.databaseCursor, DATABASE_ROWS.length)
  if (moved != null) { ui.setState({ databaseCursor: moved }); return }
  if (name !== "return" && name !== "enter") return
  switch (DATABASE_ROWS[ui.state.databaseCursor]) {
    case "import":
      try { const directory = data?.importDirectory() ?? process.cwd(); ui.beginImport(directory, data?.csvFiles(directory) ?? []) } catch (e) { reportError(ui, e) }
      return
    case "profiles": ui.setState({ importStage: "profile", importPath: "", importPathCaret: 0, importProfileCursor: 0, importProfileManaging: true }); return
    case "icons":
      if (!data) return
      data.setIcons(!data.state.icons)
      ui.setStatus(data.state.icons ? "Category icons on (needs a Nerd Font)" : "Category icons off")
      return
    // Approved port deviation: Database & Import owns the week toggle.
    case "weekStart":
      if (!data) return
      data.saveUiPrefs({ weekStart: data.state.weekStart === "monday" ? "sunday" : "monday" })
      ui.setStatus(data.state.weekStart === "sunday" ? "Weeks start on Sunday" : "Weeks start on Monday")
      return
    case "xAxis":
      if (!data) return
      data.saveUiPrefs({ xAxis: !data.state.uiPrefs.xAxis })
      ui.setStatus(data.state.uiPrefs.xAxis ? "Charts draw an x-axis line" : "Charts without an x-axis line")
      return
    case "clearData": confirmTwice(ui, data, { kind: "clearData", id: 0, label: "all transaction and import data", with: "enter" }); return
    case "reset": ui.setState({ factoryResetOpen: true, factoryResetDraft: "", factoryResetCaret: 0 }); ui.setStatus("Type RESET then enter to remove this SQLite database"); return
  }
}

/** esc in Transactions steps back one level (K3): the selection, then a
 * drill-down (back to Overview: its filter is the drill), then the filter,
 * then a special view (tag review, then the Uncategorised view). Approved
 * OpenTUI deviation from legacy, where u cleared and views had own keys. */
function stepBack(ui: UiStore, data?: DataStore): void {
  if (Object.keys(ui.state.selectedIds).length || ui.state.rangeSelecting) { ui.clearSelection(); ui.setStatus("Selection cleared"); return }
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
  if (data.state.filterQuery) { data.clearFilter(); ui.jumpManagerCursor(0, data.scopedTransactions().length); ui.setStatus("Filter cleared"); return }
  if (data.state.tagReview) { endTagReview(ui, data); return }
  if (data.state.uncategorisedOnly) { toggleUncategorised(ui, data); return }
  ui.setStatus("Nothing to clear")
}

function handleManagerTxns(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name, sequence: seq } = key
  const rows = data?.scopedTransactions() ?? []
  if (savedFilterKeys(ui, data, key)) return
  // u undoes the last change (dataStore.undo); esc clears, below.
  if (name === "u" && data) {
    void data.undo().then((summary) => ui.setStatus(summary, summary.includes("failed:") || summary.includes("waiting for Up")), (error) => reportError(ui, error))
    return
  }

  if ((name === "." || seq === ".") && data) {
    if (!data.lastRepeat()) { ui.setStatus("Nothing to repeat"); return }
    void data.repeatLast(ui.targetIds(rows)).then((summary) => ui.setStatus(summary, summary.includes("failed:")), (error) => reportError(ui, error))
    return
  }

  // Step through the accounts pane from the table.
  if (name === "a" && !key.shift && data) { stepAccount(ui, data); return }
  if (name === "m") { ui.setState({ txnView: "merchants", merchantCursor: 0, merchantTop: 0 }); ui.setStatus("Grouped by merchant · m for rows"); return }
  // With ask: terms, n shows near misses too (rows Jev hasn't settled).
  if (name === "n" && !key.shift && data && askTerms(data.state.filterExpr).length) {
    const on = !data.nearMissesShown()
    data.setAskLoose(on)
    ui.jumpManagerCursor(0, data.scopedTransactions().length)
    const counts = data.askCounts()
    ui.setStatus(on ? `Near misses shown · ${counts?.near ?? 0} below ${MATCH_AT * 100}% · n hides them` : "Matches only")
    return
  }
  // R: rules offered from what you've categorised the same way repeatedly.
  if (name === "r" && key.shift && data) {
    const n = data.allRuleOffers().length
    // With a model to ask, the list opens on the final action row when empty.
    if (!n && !hasLlm()) { ui.setStatus(`No rule to offer: one comes after you put a description in the same category ${RULE_AFTER} times`); return }
    ui.setState({ ruleOffersOpen: true, ruleOfferCursor: 0 })
    ui.setStatus(n ? `${count(n, "rule")} offered` : "No rules offered yet · enter asks the AI")
    return
  }
  // Tag review: a tag's candidates, accepted (y, Y) or dismissed (x) like
  // category suggestions; T chooses another tag, esc leaves.
  if (name === "t" && key.shift && data) { ui.setState({ tagChooserOpen: true, tagChooserQuery: "", tagChooserCursor: 0 }); ui.setStatus("Find transactions for a tag · type to filter or name a new one"); return }
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
      data.dismissTagCandidates(ids)
      ui.clearSelection()
      ui.jumpManagerCursor(Math.min(ui.state.managerCursor, Math.max(0, data.scopedTransactions().length - 1)), data.scopedTransactions().length)
      ui.setStatus(ids.length ? `Dismissed ${count(ids.length, "candidate")} for this session` : "No candidate to dismiss")
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
      data.dismissSuggestions(ids)
      ui.clearSelection()
      ui.setStatus(ids.length ? `Dismissed ${count(ids.length, "suggestion")}` : "No suggestion to dismiss")
      return
    }
  }
  if (name === "return" || name === "enter") {
    const row = (data?.scopedTransactions() ?? [])[ui.state.managerCursor]
    if (row) ui.setState({ detailId: row.id, detailNotesEditing: false })
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
    if (ui.state.rangeSelecting && hlIds.length > 0) {
      const allOn = hlIds.every((id) => ui.state.selectedIds[id])
      const next = { ...ui.state.selectedIds }
      for (const id of hlIds) {
        if (allOn) delete next[id]
        else next[id] = true
      }
      ui.setState({ selectedIds: next, rangeSelecting: false })
      ui.setStatus(allOn ? `Deselected ${hlIds.length}` : `Selected ${hlIds.length}`)
    } else {
      const row = rows[ui.state.managerCursor]
      if (row) {
        ui.toggleSelectedId(row.id)
      }
    }
    return
  }
  const moved = listMove(key, ui.state.managerCursor, rows.length)
  if (moved != null) {
    if (name === "g" || seq === "G") {
      ui.jumpManagerCursor(moved, rows.length)
      ui.setRangeFromMove(0, 0, false)
      ui.setStatus(key.shift || seq === "G" ? "Bottom" : "Top")
    } else moveTxnCursor(ui, data, moved - ui.state.managerCursor, key.shift)
    return
  }
  if (name === "pageup") {
    moveTxnCursor(ui, data, -ui.state.managerVisible, key.shift)
    return
  }
  if (name === "pagedown") {
    moveTxnCursor(ui, data, ui.state.managerVisible, key.shift)
    return
  }
}

function handleManagerAccounts(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  if (!data) return
  const stacks = accountStacks(data.state.accounts)
  const rows = stacks.flatMap((stack) => stack.rows)
  const at = rows.findIndex((row) => row.selection === data.state.accountSelection)
  const select = (index: number) => {
    const row = rows[index]
    if (!row || row.selection === data.state.accountSelection) return
    ui.setState({ managerCursor: 0, managerTop: 0, selectedIds: {}, rangeSelecting: false })
    data.setAccountSelection(row.selection)
  }
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
  if ((name === "d" || name === "delete") && accountId != null) { ui.setState({ accountActionId: accountId, accountActionCursor: 0 }); ui.setStatus("Account data · enter twice to clear or remove · esc cancel"); return }
}

function handleSettingsBudgets(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  if (!data) return
  const budgets = data.state.budgets
  // Row 0 is the cycle; the budgets follow.
  const budget = budgets[ui.state.budgetCursor - 1]
  if (name === "escape") { ui.leaveSettings(); return }
  const moved = listMove(key, ui.state.budgetCursor, budgets.length + 1)
  if (moved != null) { ui.setState({ budgetCursor: moved }); return }
  if (name === "a") {
    const taken = new Set(budgets.map((b) => scopeKey(b.scope)))
    const free = budgetScopeOptions(data.state.accounts, data.state.categories).find((o) => !taken.has(o.key))
    ui.openSettingsEditor("budget", null, { ...ui.state.settingsDraft, ...cycleDraft(data.state.budgetCycle), scopeKey: free?.key ?? "overall", amount: "" })
    return
  }
  if ((name === "return" || name === "enter") && ui.state.budgetCursor === 0) {
    ui.openSettingsEditor("cycle", null, { ...ui.state.settingsDraft, ...cycleDraft(data.state.budgetCycle) })
    return
  }
  if ((name === "return" || name === "enter") && budget) {
    ui.openSettingsEditor("budget", budget.id, { ...ui.state.settingsDraft, ...cycleDraft(data.state.budgetCycle), scopeKey: scopeKey(budget.scope), amount: String(budget.amount) })
    return
  }
  if ((name === "delete" || name === "backspace") && budget) {
    confirmTwice(ui, data, { kind: "budget", id: budget.id, label: `the ${budgetLabel(budget, data.state.accounts, data.state.categories)} budget`, with: "delete" })
    return
  }

}

function handleManagerMerchants(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name, sequence: seq } = key
  if (!data) return
  if (savedFilterKeys(ui, data, key)) return
  // u undoes the last change (dataStore.undo); esc clears, below.
  if (name === "u" && data) {
    void data.undo().then((summary) => ui.setStatus(summary, summary.includes("failed:") || summary.includes("waiting for Up")), (error) => reportError(ui, error))
    return
  }

  // The same filtered, scoped rows as the table, summarised per merchant.
  const groups = sortMerchantGroups(groupByMerchant(data.scopedTransactions()), ui.state.merchantSort, ui.state.merchantReverse)
  const group = groups[ui.state.merchantCursor]
  const moveTo = (i: number) => ui.setState({ merchantCursor: Math.max(0, Math.min(groups.length - 1, i)) })
  if (name === "a" && !key.shift) { stepAccount(ui, data); ui.setState({ merchantCursor: 0 }); return }
  if (name === "m") { ui.setState({ txnView: "rows" }); ui.setStatus("Transactions"); return }
  const moved = listMove(key, ui.state.merchantCursor, groups.length)
  if (moved != null) { moveTo(moved); return }
  if (name === "pagedown") { moveTo(ui.state.merchantCursor + ui.state.managerVisible); return }
  if (name === "pageup") { moveTo(ui.state.merchantCursor - ui.state.managerVisible); return }
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
    ui.setState({ txnView: "rows" })
    ui.jumpManagerCursor(0, data.scopedTransactions().length)
    ui.setStatus(`${group.merchant} · ${count(group.count, "transaction")} · esc to widen`)
    return
  }
  if (name === "c" && group) { openCategoryPicker(ui, group.ids, data); return }
  if (name === "t" && group) { ui.openTagPicker(group.ids); return }
  if (name === "escape") {
    if (data.state.filterQuery) { data.clearFilter(); ui.setState({ merchantCursor: 0 }); ui.setStatus("Filter cleared") }
    else { ui.setState({ txnView: "rows" }); ui.setStatus("Transactions") }
    return
  }
}

function handleOverview(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name, sequence: seq } = key
  const scope = ui.activeScope()
  const clock = appNow()
  const cycle = data?.cycle()
  // h/l (or ,/.) step the focused chart pane's views, the top pane when
  // neither is focused; H/L always step the bottom pane.
  const back = seq === "H" || ((name === "h" || name === "left" || seq === ",") && scope === "overview")
  const forward = seq === "L" || ((name === "l" || name === "right" || seq === ".") && scope === "overview")
  if (back || forward) {
    const pane = seq === "H" || seq === "L" || key.shift || ui.state.focusedSection === "ov.chart2" ? 1 : 0
    const n = CHART_VIEWS.length
    const views: [number, number] = [...ui.state.chartViews]
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
    ui.switchTab("manager")
    ui.setState({ focusedSection: "mgr.transactions" })
    if (!data.state.uncategorisedOnly) toggleUncategorised(ui, data)
    return
  }
  // / searches: the Transactions filter, opened from here (the Overview
  // itself is not filtered); ? goes straight to a smart search.
  if (isSmartSearchKey(key) && scope === "overview") {
    ui.switchTab("manager")
    openSmartSearch(ui, data)
    return
  }
  if ((name === "/" || seq === "/") && scope === "overview") {
    ui.switchTab("manager")
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
    data.setAccountSelection(next)
    ui.setStatus(`Overview · ${spendingScope(data.state.accounts, next).label}`)
    return
  }
  if (name === "[" || seq === "[" || name === "]" || seq === "]") {
    const delta = name === "[" || seq === "[" ? -1 : 1
    if (ui.state.timeframe.family === "period") {
      const tf = stepPeriod(ui.state.timeframe, delta, cycle)
      ui.setTimeframe(tf)
      ui.setStatus(`${PERIOD_LABEL[tf.period]} · ${timeframeBounds(tf, clock, cycle).label}`)
    } else if (ui.state.timeframe.family === "custom") {
      const tf = stepCustom(ui.state.timeframe, delta)
      ui.setTimeframe(tf)
      ui.setStatus(`Custom · ${timeframeBounds(tf, clock, cycle).label}`)
    } else {
      ui.setStatus(`${ui.state.timeframe.lookback} always ends today · [ ] step Cycle, Month… and Custom ranges`)
    }
    return
  }
  // Drill-down (Go app): enter opens Transactions filtered to the focused
  // category line, or to all the range's spending from a chart; esc there
  // comes back. With Categories focused, j/k move over every line.
  const focus = ui.state.focusedSection
  if (data && focus === "ov.categories") {
    const lines = allCategoryLines(overviewRange(data, ui.state))
    const moveTo = (i: number) => ui.setState({ overviewCategoryCursor: Math.max(0, Math.min(lines.length - 1, i)) })
    const moved = listMove(key, ui.state.overviewCategoryCursor, lines.length)
    if (moved != null) { moveTo(moved); return }
    const line = lines[Math.min(ui.state.overviewCategoryCursor, lines.length - 1)]
    if ((name === "return" || name === "enter") && line) { drillDown(ui, data, line); return }
  }
  if (data && (focus === "ov.chart" || focus === "ov.chart2") && (name === "return" || name === "enter")) { drillDown(ui, data); return }
  if (name === "0") {
    // The same kind of range, now (this month, this quarter…).
    const tf = timeframeNow(ui.state.timeframe, appNow(), cycle)
    ui.setTimeframe(tf)
    ui.setStatus(`Now · ${timeframeBounds(tf, clock, cycle).label}`)
    return
  }
  if (name === "z" && data) {
    // Balance charts: fit the balances, or run the axis from $0.
    data.saveUiPrefs({ zeroAxis: !data.state.uiPrefs.zeroAxis })
    ui.setStatus(data.state.uiPrefs.zeroAxis ? "Balance charts from $0" : "Balance charts fit their balances")
    return
  }
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

function handleOverviewRange(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  const clock = appNow()
  const cycle = data?.cycle()
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
    // Custom asks for dates, starting from the last custom range or the
    // range on screen.
    const from = ui.state.timeframe.custom ?? timeframeBounds(ui.state.timeframe, clock, cycle)
    ui.setState({ customEdit: { start: textField(from.start), end: textField(from.end), field: 0, error: "" } })
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
    ui.setState({ settingsEditField: 1, settingsCaret: 0 })
    return true
  }
  if (key.name === "l") { ui.setState({ filterPicker: { query: "", cursor: 0 } }); return true }
  return false
}

/** Open Transactions on the Overview range's spending, narrowed to one
 * category line when given, remembering where to come back to. */
function drillDown(ui: UiStore, data: DataStore, line?: CategoryLine) {
  const range = overviewRange(data, ui.state)
  const query = drillFilter({
    start: range.bounds.start,
    end: range.bounds.end,
    accounts: range.scope.accounts.map((a) => a.name),
    category: line ? { id: line.categoryId, name: line.label } : undefined,
    categories: data.state.categories,
  })
  const back = { filter: data.state.filterQuery, focus: ui.state.focusedSection }
  ui.switchTab("manager")
  const result = data.commitFilter(query)
  if (!result.ok) { ui.setStatus(result.err, true); return }
  ui.setState({ drillReturn: back, txnView: "rows", focusedSection: "mgr.transactions" })
  const n = data.scopedTransactions().length
  ui.jumpManagerCursor(0, n)
  ui.setStatus(`${line?.label ?? "Spending"} · ${range.bounds.label} · ${count(n, "transaction")} · esc back`)
}

type HintState = Pick<UiState, "focusedSection" | "drillReturn" | "chartViews"> & {
  /** From the data store: the Transactions table is the Uncategorised view. */
  uncategorisedOnly?: boolean
  /** In the filter: ↑ would bring back the smart search's question. */
  recallQuestion?: boolean
  /** The AI models dialog is taking a key, account id or model. */
  aiField?: boolean
  /** The sign-in modal is asking for a pasted code or URL. */
  signInPaste?: boolean
  /** A tag review is open. */
  tagReview?: boolean
  /** Rules offered (R). */
  ruleOffers?: number
  /** The filter has `ask:` terms; whether near misses are shown. */
  asks?: boolean
  askLoose?: boolean
}
type ScopeEntry = {
  handle: (ui: UiStore, key: KeyEvent, data?: DataStore) => void
  hints: (state?: HintState) => { key: string; desc: string }[]
  quits: boolean
}

const scopes: Record<ScopeId, ScopeEntry> = {
  "palette": {
    handle: handlePalette,
    quits: false,
    hints: () => [{ key: "↑↓ ^j/k", desc: "move" }, { key: "enter", desc: "run" }, { key: "esc", desc: "close" }, { key: "type", desc: "filter" }],
  },
  "filterPicker": {
    handle: handleFilterPicker,
    quits: false,
    hints: () => [{ key: "↑↓ ^j/k", desc: "move" }, { key: "enter", desc: "apply" }, { key: "esc", desc: "close" }, { key: "type", desc: "filter" }],
  },
  "dryRun": {
    handle: handleDryRun,
    quits: false,
    hints: () => [{ key: "j/k", desc: "scroll" }, { key: "esc", desc: "close" }],
  },
  "jump": {
    handle: handleJump,
    quits: false,
    hints: () => [
      { key: "letter", desc: "jump" },
      { key: "esc", desc: "cancel" },
    ],
  },
  "tagPicker": {
    handle: handleTagPicker,
    quits: false,
    hints: () => [
      { key: "↑↓ ^j/k", desc: "move" },
      { key: "space", desc: "stage" },
      { key: "enter", desc: "apply" },
      { key: "esc", desc: "cancel" },
    ],
  },
  "tagChooser": {
    handle: handleTagChooser,
    quits: false,
    hints: () => [{ key: "↑↓ ^j/k", desc: "move" }, { key: "type", desc: "filter or new tag" }, { key: "enter", desc: "find" }, { key: "esc", desc: "cancel" }],
  },
  "catPicker": {
    handle: handleCatPicker,
    quits: false,
    hints: () => [
      { key: "↑↓ ^j/k", desc: "move" },
      { key: "enter", desc: "apply" },
      { key: "esc", desc: "cancel" },
      { key: "type", desc: "filter" },
    ],
  },
  "filter": {
    handle: handleFilter,
    quits: false,
    hints: (state) => [
      { key: "enter", desc: "apply" },
      { key: "esc", desc: "clear" },
      { key: "type", desc: "expr" },
      { key: "?…", desc: "ask in words" },
      ...(state?.recallQuestion ? [{ key: "↑", desc: "your question" }] : []),
    ],
  },
  "manager.detail": {
    handle: handleManagerDetail,
    quits: false,
    hints: () => [{ key: "j/k", desc: "prev/next" }, { key: "c", desc: "category" }, { key: "t", desc: "tags" }, { key: "n", desc: "notes" }, { key: "esc", desc: "close" }],
  },
  "overview.custom": {
    handle: handleOverviewCustom,
    quits: false,
    hints: () => [
      { key: "tab", desc: "field" },
      { key: "enter", desc: "apply" },
      { key: "esc", desc: "cancel" },
    ],
  },
  "settings.factoryReset": {
    handle: handleSettingsFactoryReset,
    quits: false,
    hints: () => [{ key: "type RESET", desc: "confirm" }, { key: "enter", desc: "erase DB" }, { key: "esc", desc: "cancel" }],
  },
  "settings.aiDialog": {
    handle: handleAiDialog,
    quits: false,
    hints: (state) => state?.aiField ? [{ key: "enter", desc: "save" }, { key: "esc", desc: "back" }] : [{ key: "j/k", desc: "move" }, { key: "enter", desc: "do" }, { key: "esc", desc: "close" }],
  },
  "llmSignIn": {
    handle: (ui, key) => handleLlmSignIn(ui, key),
    quits: false,
    hints: (state) => [...(state?.signInPaste ? [{ key: "enter", desc: "send" }] : []), { key: "esc", desc: "cancel" }],
  },
  "manager.ruleOffers": {
    handle: handleRuleOffers,
    quits: false,
    hints: () => [{ key: "j/k", desc: "move" }, { key: "enter", desc: "make rule" }, { key: "x", desc: "never" }, { key: "esc", desc: "later" }],
  },
  "manager.acceptPreview": {
    handle: handleManagerAcceptPreview,
    quits: false,
    hints: () => [{ key: "enter", desc: "accept" }, { key: "esc", desc: "cancel" }],
  },
  "manager.accountAction": {
    handle: handleManagerAccountAction,
    quits: false,
    hints: () => [{ key: "j/k", desc: "move" }, { key: "enter", desc: "do (twice)" }, { key: "esc", desc: "cancel" }],
  },
  "settings.editor": {
    handle: handleSettingsEditor,
    quits: false,
    hints: () => [{ key: "↑/↓", desc: "field" }, { key: "←/→", desc: "change" }, { key: "enter", desc: "save / choose" }, { key: "esc", desc: "cancel" }],
  },
  "settings.import.files": {
    handle: handleSettingsImportFiles,
    quits: false,
    hints: () => [{ key: "j/k", desc: "file" }, { key: "enter", desc: "select" }, { key: "p", desc: "path" }, { key: "esc", desc: "cancel" }],
  },
  "settings.import.path": {
    handle: handleSettingsImportPath,
    quits: false,
    hints: () => [{ key: "enter", desc: "open" }, { key: "esc", desc: "back" }, { key: "type", desc: "path" }],
  },
  "settings.import.profile": {
    handle: handleSettingsImportProfile,
    quits: false,
    hints: () => [{ key: "j/k", desc: "profile" }, { key: "enter", desc: "select" }, { key: "a/e", desc: "new/edit" }, { key: "del del", desc: "delete" }, { key: "esc", desc: "back" }],
  },
  "settings.import.profileEditor": {
    handle: handleSettingsImportProfileEditor,
    quits: false,
    hints: () => [{ key: "tab", desc: "field" }, { key: "h/l", desc: "choice" }, { key: "enter", desc: "save" }, { key: "esc", desc: "back" }],
  },
  "settings.import.preview": {
    handle: handleSettingsImportPreview,
    quits: false,
    hints: () => [{ key: "s", desc: "skip dupes" }, { key: "a", desc: "force import" }, { key: "p", desc: "all/dupes" }, { key: "r", desc: "rules" }, { key: "esc", desc: "cancel" }],
  },
  "settings": {
    handle: handleSettings,
    quits: true,
    hints: () => [
      { key: "j/k", desc: "section" },
      { key: "h/l", desc: "column" },
      { key: "enter", desc: "activate" },
      { key: "v", desc: "jump" },
      { key: "1-3", desc: "tab" },
    ],
  },
  "settings.taxonomy": {
    handle: handleSettingsTaxonomy,
    quits: true,
    hints: () => [
      { key: "h/l", desc: "list" }, { key: "j/k", desc: "move" },
      { key: "a", desc: "add" }, { key: "enter", desc: "edit" },
      { key: "del del", desc: "delete" }, { key: "esc", desc: "done" },
    ],
  },
  "settings.rules": {
    handle: handleSettingsRules,
    quits: true,
    hints: () => [
      { key: "j/k", desc: "move" }, { key: "enter", desc: "edit" }, { key: "space", desc: "toggle" },
      { key: "a", desc: "add" }, { key: "del del", desc: "delete" }, { key: "S-j/k", desc: "reorder" },
      { key: "S-a", desc: "apply" }, { key: "S-d", desc: "dry run" }, { key: "esc", desc: "done" },
    ],
  },
  "settings.filters": {
    handle: handleSettingsFilters,
    quits: true,
    hints: () => [{ key: "j/k", desc: "move" }, { key: "a", desc: "add" }, { key: "enter", desc: "edit" }, { key: "del del", desc: "delete" }, { key: "esc", desc: "done" }],
  },
  "settings.up": {
    handle: handleSettingsUp,
    quits: true,
    hints: () => [{ key: "j/k", desc: "move" }, { key: "enter", desc: "sync on/off" }, { key: "s", desc: "sync now" }, { key: "esc", desc: "done" }],
  },
  "settings.ai": {
    handle: handleSettingsAi,
    quits: true,
    hints: () => [{ key: "j/k", desc: "move" }, { key: "enter", desc: "open" }, { key: "esc", desc: "done" }],
  },
  "settings.database": {
    handle: handleSettingsDatabase,
    quits: true,
    hints: () => [{ key: "j/k", desc: "move" }, { key: "enter", desc: "open / switch" }, { key: "esc", desc: "done" }],
  },
  "manager.txns": {
    handle: handleManagerTxns,
    quits: true,
    hints: (state) => state?.tagReview ? [
      { key: "y", desc: "tag" },
      { key: "Y", desc: `tag all ≥${ACCEPT_ALL_AT * 100}%` },
      { key: "x", desc: "dismiss" },
      { key: "u", desc: "undo" },
      { key: "space", desc: "select" },
      { key: "S-j/k", desc: "range" },
      { key: "T", desc: "other tag" },
      { key: "esc", desc: "done" },
      { key: "s", desc: "sort" },
      { key: "enter", desc: "detail" },
    ] : state?.uncategorisedOnly ? [
      { key: "y", desc: "accept" },
      { key: "Y", desc: `accept all ≥${ACCEPT_ALL_AT * 100}%` },
      { key: "x", desc: "dismiss" },
      { key: "u", desc: "undo" },
      { key: "c", desc: "choose" },
      ...(state?.ruleOffers ? [{ key: "R", desc: `rules (${state.ruleOffers})` }] : []),
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
      { key: "c", desc: "category" },
      { key: "t", desc: "tag" },
      { key: "space", desc: "select" },
      { key: "/", desc: "filter" },
      { key: "?", desc: "smart search" },
      { key: "u", desc: "undo" },
      ...(state?.drillReturn ? [{ key: "esc", desc: "back" }] : [{ key: "esc", desc: "clear" }]),
      ...(state?.ruleOffers ? [{ key: "R", desc: `rules (${state.ruleOffers})` }] : []),
      ...(state?.asks ? [{ key: "n", desc: state.askLoose ? "matches only" : "near misses" }] : []),
      { key: "enter", desc: "detail" },
      { key: ".", desc: "repeat" },
      { key: "i", desc: "uncategorised" },
      { key: "T", desc: "tag review" },
      { key: "m", desc: "merchants" },
      { key: "a", desc: "account" },
      { key: "S-j/k", desc: "range" },
      { key: "s", desc: "sort" },
      { key: "S-s", desc: "reverse" },
      { key: "ctrl+s", desc: "save filter" },
      { key: "ctrl+l", desc: "saved filters" },
      { key: "g", desc: "top" },
      { key: "G", desc: "bottom" },
      { key: "v", desc: "jump" },
    ],
  },
  "manager.accounts": {
    handle: handleManagerAccounts,
    quits: true,
    hints: () => [
      { key: "j/k", desc: "account" },
      { key: "h/l", desc: "bank" },
      { key: "enter", desc: "transactions" },
      { key: "d", desc: "data actions" },
      { key: "v", desc: "jump" },
    ],
  },
  "settings.budgets": {
    handle: handleSettingsBudgets,
    quits: true,
    hints: () => [{ key: "j/k", desc: "move" }, { key: "a", desc: "add" }, { key: "enter", desc: "edit" }, { key: "del del", desc: "delete" }, { key: "esc", desc: "done" }],
  },
  "manager.merchants": {
    handle: handleManagerMerchants,
    quits: true,
    hints: () => [
      { key: "j/k", desc: "move" },
      { key: "enter", desc: "its transactions" },
      { key: "c", desc: "category" },
      { key: "t", desc: "tags" },
      { key: "/", desc: "filter" },
      { key: "s", desc: "sort" },
      { key: "u", desc: "undo" },
      { key: "esc", desc: "back" },
      { key: "?", desc: "smart search" },
      { key: "m", desc: "rows" },
      { key: "a", desc: "account" },
      { key: "ctrl+s", desc: "save filter" },
      { key: "ctrl+l", desc: "saved filters" },
    ],
  },
  "overview": {
    handle: handleOverview,
    quits: true,
    hints: (state) => {
      if (state?.focusedSection === "ov.categories") return [
        { key: "j/k", desc: "move" },
        { key: "enter", desc: "transactions" },
        { key: "[ ]", desc: "prev/next range" },
        { key: "esc", desc: "done" },
      ]
      return [
        ...(state?.focusedSection === "ov.chart" || state?.focusedSection === "ov.chart2" ? [{ key: "enter", desc: "transactions" }] : []),
        { key: "h/l", desc: "chart" },
        { key: "d/D", desc: "range" },
        { key: "[ ]", desc: "prev/next" },
        { key: "c", desc: "this cycle" },
        { key: "a", desc: "account" },
        { key: "i", desc: "review" },
        { key: "/", desc: "search" },
        { key: "?", desc: "smart search" },
        { key: "H/L", desc: "bottom chart" },
        { key: "0", desc: "now" },
        ...(state?.chartViews.some((i) => CHART_VIEWS[i]?.group === "Balances") ? [{ key: "z", desc: "$0 axis" }] : []),
        { key: "v", desc: "jump" },
        { key: "1-3", desc: "tab" },
      ]
    },
  },
  "overview.range": {
    handle: handleOverviewRange,
    quits: true,
    hints: () => [
      { key: "h/l", desc: "chip" },
      { key: "enter", desc: "apply" },
      { key: "[ ]", desc: "prev/next range" },
      { key: "esc", desc: "done" },
    ],
  },
  "manager.detail.notes": {
    handle: handleManagerDetailNotes,
    quits: false,
    hints: () => [{ key: "type", desc: "notes" }, { key: "enter", desc: "save" }, { key: "esc", desc: "cancel" }],
  },
}

export function scopeQuits(scope: ScopeId): boolean { return scopes[scope].quits }

/** Every hint for a scope: the palette's commands; the footer shows
 * footerShown's cut of them. */
export function footerHints(scope: ScopeId, state?: HintState): { key: string; desc: string }[] {
  return scopes[scope].hints(state)
}

/** What the footer shows in a scope: its hints, cut to the first few and
 * "ctrl+k all" where the palette opens. */
export function footerLine(scope: ScopeId, state?: HintState): Hint[] {
  return footerShown(footerHints(scope, state), scopes[scope].quits)
}

/** The state the hints read, from both stores. */
export function hintState(ui: UiStore, data?: DataStore): HintState {
  return {
    focusedSection: ui.state.focusedSection, drillReturn: ui.state.drillReturn, chartViews: ui.state.chartViews,
    uncategorisedOnly: data?.state.uncategorisedOnly, tagReview: !!data?.state.tagReview,
    signInPaste: !!ui.state.llmSignIn?.paste, aiField: !!ui.state.aiDialog?.field,
    ruleOffers: data && ui.state.activeTab === "manager" ? data.allRuleOffers().length : 0,
    asks: !!data?.askCounts(), askLoose: data?.nearMissesShown(),
    recallQuestion: !!smartQuestionFor(ui.state, ui.state.filterDraft),
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
  const next = rows[(at + 1) % rows.length]!
  data.setAccountSelection(next.selection)
  ui.jumpManagerCursor(0, data.scopedTransactions().length)
  ui.setStatus(`Showing ${next.label}`)
}
