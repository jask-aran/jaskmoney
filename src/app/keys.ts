import type { KeyEvent } from "@opentui/core"
import { resolve } from "node:path"
import { batch } from "solid-js"
import { accountRole } from "../domain/types"
import { accountRows, accountStacks, spendingScope, type AccountSelection } from "../domain/accountTree"
import { assignableCategories } from "../domain/categoryOptions"
import { budgetLabel, budgetScopeOptions, scopeKey } from "../domain/budgetScopes"
import type { CycleConfig } from "../domain/budget"
import { MERCHANT_SORTS, groupByMerchant, merchantFilter, sortMerchantGroups } from "../domain/merchants"
import { anchorDraft, cycleFromDraft, editorFields, normaliseCycleDraft, pickerChoices, pickerItems, stepChoice } from "../state/settingsForm"
import { runSync } from "./sync"
import { runSmartSearch } from "./smartSearch"
import { runAsk } from "./ask"
import { runAccept, toggleUncategorised } from "./suggest"
import { ACCEPT_ALL_AT } from "../domain/suggest"
import { CHART_VIEWS, JUMP_TARGETS, SETTINGS_SECTIONS, TABS, settingsSectionFocus, type ScopeId, type UiState, type UiStore } from "../state/uiStore"
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
  const step = key.name === "down" || (key.ctrl && key.name === "n") ? 1 : key.name === "up" || (key.ctrl && key.name === "p") ? -1 : 0
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

export function handleKey(ui: UiStore, key: KeyEvent, data?: DataStore): boolean {
  const { name, sequence: seq } = key
  if (key.ctrl && name === "c") return false
  // Sync from anywhere, including over overlays: it changes no UI state.
  if (key.ctrl && name === "r") {
    if (data) void runSync(ui, data, { manual: true })
    return true
  }
  const entry = scopes[ui.activeScope()]
  if (entry.quits) {
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
          const id = data.createSettingsTag({ name: ui.state.tagPickerQuery.trim(), color: theme.blue, categoryId: null })
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

function handleCatPicker(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const cats = assignableCategories(data?.state.categories ?? [], ui.state.catPickerQuery)
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
        data.categorizeTransactions(targets, cat.id).then(
          (summary) => ui.setStatus(summary, summary.includes(" failed: ")),
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
  if (name === "escape") {
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
  if (name === "c") { ui.openCatPicker(ui.targetIds(data?.scopedTransactions() ?? [])); return }
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
  if (name === "c" && account) { ui.setState({ accountActionId: null }); ui.armSettingsConfirm({ kind: "clearAccount", id: account.id, label: account.name }); ui.setStatus(`Press del to clear ${account.name}`); return }
  if ((name === "x" || name === "delete") && account) { ui.setState({ accountActionId: null }); ui.armSettingsConfirm({ kind: "deleteAccount", id: account.id, label: account.name }); ui.setStatus(`Press del to remove ${account.name} and its transactions`); return }
}

function handleSettingsConfirm(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  if (name === "escape") { ui.clearSettingsConfirm(); ui.setStatus("Action cancelled"); return }
  const confirm = ui.state.settingsConfirm
  if (!confirm) return
  if (name !== "delete" && name !== "backspace") return
  try {
    const done = CONFIRMED[confirm.kind](data, confirm)
    ui.clearSettingsConfirm()
    ui.setStatus(done)
  } catch (e) { ui.clearSettingsConfirm(); reportError(ui, e) }
}

type Confirm = NonNullable<UiState["settingsConfirm"]>

/** What each armed confirmation does on del, and the status it leaves. */
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
        if (ui.state.settingsEditId == null) data?.createSettingsTag({ name: draft.name, color: draft.color, categoryId: draft.categoryId })
        else data?.updateSettingsTag(Number(ui.state.settingsEditId), { name: draft.name, color: draft.color, categoryId: draft.categoryId })
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
  if (name === "delete" && profiles[ui.state.importProfileCursor]) { const selected = profiles[ui.state.importProfileCursor]!; ui.armSettingsConfirm({ kind: "profile", id: selected.id, label: selected.name }); ui.setStatus(`Press del again to delete profile ${selected.name}`); return }
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
    try { const summary = data?.commitPreview({ ...preview, rulesEnabled: ui.state.importPreviewRules }, name === "s") ?? "Import unavailable"; ui.cancelImport(); ui.setStatus(summary) } catch (e) { reportError(ui, e) }
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
    ui.openSettingsEditor(list === "categories" ? "category" : "tag", null, { ...ui.state.settingsDraft, name: "", color: list === "categories" ? "#94e2d5" : "#89b4fa", categoryId: null, notSpending: false })
    return
  }
  if ((name === "return" || name === "enter") && items[cursor]) {
    const item = items[cursor]!
    ui.openSettingsEditor(list === "categories" ? "category" : "tag", item.id, { ...ui.state.settingsDraft, name: item.name, color: item.color, categoryId: list === "tags" ? ("categoryId" in item ? item.categoryId : null) : null, notSpending: "notSpending" in item ? item.notSpending : false })
    return
  }
  if (name === "delete" && items[cursor]) { ui.armSettingsConfirm({ kind: list === "categories" ? "category" : "tag", id: items[cursor]!.id, label: items[cursor]!.name }); ui.setStatus(`Press del again to delete ${items[cursor]!.name}`); return }
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
  if (name === "delete" && rule) { ui.armSettingsConfirm({ kind: "rule", id: rule.id, label: rule.name }); ui.setStatus(`Press del again to delete ${rule.name}`); return }
}

function handleSettingsFilters(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  const filters = data?.state.savedFilters ?? []; const cursor = ui.state.filterCursor; const filter = filters[cursor]
  if (name === "escape") { ui.leaveSettings(); return }
  const moved = listMove(key, ui.state.filterCursor, filters.length)
  if (moved != null) { ui.setState({ filterCursor: moved }); return }
  if (name === "a") { const id = `filter-${filters.length + 1}`; ui.openSettingsEditor("filter", null, { ...ui.state.settingsDraft, id, name: "", expr: "" }); return }
  if ((name === "return" || name === "enter") && filter) { ui.openSettingsEditor("filter", filter.id, { ...ui.state.settingsDraft, id: filter.id, name: filter.name, expr: filter.expr }); return }
  if (name === "delete" && filter) { ui.armSettingsConfirm({ kind: "filter", id: filter.id, label: filter.name }); ui.setStatus(`Press del again to delete ${filter.name}`); return }
}

function handleSettingsUp(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  const accounts = data?.state.syncAccounts ?? []
  const account = accounts[ui.state.upCursor]
  if (name === "escape") { ui.leaveSettings(); return }
  const moved = listMove(key, ui.state.upCursor, accounts.length)
  if (moved != null) { ui.setState({ upCursor: moved }); return }
  if (name === "space" && account && data) {
    // Switching off deletes the account's transactions, so it is confirmed.
    if (account.syncEnabled) { ui.armSettingsConfirm({ kind: "desyncAccount", id: account.id, label: account.name }); ui.setStatus(`Press del to stop syncing ${account.name}`); return }
    try { data.setAccountSync(account.id, true); ui.setStatus(`Sync on for ${account.name} · s to sync now`) } catch (e) { reportError(ui, e) }
    return
  }
  if (name === "s" && data) {
    if (data.state.upSyncing) { ui.setStatus("Up sync already running"); return }
    ui.setStatus("Syncing Up…")
    data.syncUp().then(
      (summary) => ui.setStatus(summary),
      (e) => reportError(ui, e),
    )
    return
  }
}

function handleSettingsDatabase(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  if (name === "escape") { ui.leaveSettings(); return }
  if (name === "i") {
    try { const directory = data?.importDirectory() ?? process.cwd(); ui.beginImport(directory, data?.csvFiles(directory) ?? []) } catch (e) { reportError(ui, e) }
    return
  }
  if (name === "p") { ui.setState({ importStage: "profile", importPath: "", importPathCaret: 0, importProfileCursor: 0, importProfileManaging: true }); return }
  if (name === "n" && data) {
    data.setIcons(!data.state.icons)
    ui.setStatus(data.state.icons ? "Category icons on (needs a Nerd Font)" : "Category icons off")
    return
  }
  // Approved port deviation: Database & Import owns the week toggle.
  if (name === "w" && data) {
    data.saveUiPrefs({ weekStart: data.state.weekStart === "monday" ? "sunday" : "monday" })
    ui.setStatus(data.state.weekStart === "sunday" ? "Weeks start on Sunday" : "Weeks start on Monday")
    return
  }
  if (name === "b" && data) {
    data.saveUiPrefs({ xAxis: !data.state.uiPrefs.xAxis })
    ui.setStatus(data.state.uiPrefs.xAxis ? "Charts draw an x-axis line" : "Charts without an x-axis line")
    return
  }
  if (name === "c") { ui.armSettingsConfirm({ kind: "clearData", id: 0, label: "all transaction and import data" }); ui.setStatus("Press del to clear all transaction and import data"); return }
  if (name === "x") { ui.setState({ factoryResetOpen: true, factoryResetDraft: "", factoryResetCaret: 0 }); ui.setStatus("Type RESET then enter to remove this SQLite database"); return }
}

function handleManagerTxns(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name, sequence: seq } = key
  const rows = data?.scopedTransactions() ?? []
  if (savedFilterKeys(ui, data, key)) return

  // Step through the accounts pane from the table.
  if (name === "a" && !key.shift && data) { stepAccount(ui, data); return }
  if (name === "m") { ui.setState({ txnView: "merchants", merchantCursor: 0, merchantTop: 0 }); ui.setStatus("Grouped by merchant · m for rows"); return }
  // The Uncategorised view: rows waiting for a category, with suggestions
  // to accept (y: these rows, Y: every confident one) or dismiss (x).
  if (name === "i" && !key.shift && data) { toggleUncategorised(ui, data); return }
  if (data?.state.uncategorisedOnly) {
    if (name === "y" && !key.shift) { void runAccept(ui, data, ui.targetIds(rows)); return }
    if (name === "y" && key.shift) {
      void runAccept(ui, data, rows.filter((r) => (data.state.suggestions[r.id]?.confidence ?? 0) >= ACCEPT_ALL_AT).map((r) => r.id))
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
  if (name === "/" || seq === "/") {
    ui.openFilter(data?.state.filterQuery ?? "")
    return
  }
  if (name === "escape" && ui.state.drillReturn && data && !Object.keys(ui.state.selectedIds).length && !ui.state.rangeSelecting) {
    // Back from a drill-down: the filter it replaced, the section it left.
    const back = ui.state.drillReturn
    if (back.filter) data.commitFilter(back.filter)
    else data.clearFilter()
    ui.switchTab("overview")
    ui.setState({ focusedSection: back.focus })
    ui.setStatus("Overview")
    return
  }
  if (name === "u" || name === "escape") {
    // Approved OpenTUI deviation from legacy: Esc mirrors u, clearing the
    // current selection/range before an applied filter.
    const nSel = Object.keys(ui.state.selectedIds).length
    if (nSel > 0 || ui.state.rangeSelecting) {
      ui.clearSelection()
      ui.setStatus("Selection cleared")
    } else if (data?.state.filterQuery) {
      data.clearFilter()
      ui.jumpManagerCursor(0, data.scopedTransactions().length)
      ui.setStatus("Filter cleared")
    }
    return
  }
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
    ui.openCatPicker(ui.targetIds(rows))
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
  if ((name === "d" || name === "delete") && accountId != null) { ui.setState({ accountActionId: accountId }); ui.setStatus("Account data · c clear transactions · x remove account · esc cancel"); return }
}

function handleSettingsBudgets(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  if (!data) return
  const budgets = data.state.budgets
  const budget = budgets[ui.state.budgetCursor]
  if (name === "escape") { ui.leaveSettings(); return }
  const moved = listMove(key, ui.state.budgetCursor, budgets.length)
  if (moved != null) { ui.setState({ budgetCursor: moved }); return }
  if (name === "a") {
    const taken = new Set(budgets.map((b) => scopeKey(b.scope)))
    const free = budgetScopeOptions(data.state.accounts, data.state.categories).find((o) => !taken.has(o.key))
    ui.openSettingsEditor("budget", null, { ...ui.state.settingsDraft, ...cycleDraft(data.state.budgetCycle), scopeKey: free?.key ?? "overall", amount: "" })
    return
  }
  if ((name === "return" || name === "enter") && budget) {
    ui.openSettingsEditor("budget", budget.id, { ...ui.state.settingsDraft, ...cycleDraft(data.state.budgetCycle), scopeKey: scopeKey(budget.scope), amount: String(budget.amount) })
    return
  }
  if ((name === "delete" || name === "backspace") && budget) {
    ui.armSettingsConfirm({ kind: "budget", id: budget.id, label: `the ${budgetLabel(budget, data.state.accounts, data.state.categories)} budget` })
    ui.setStatus("Press del to delete the budget")
    return
  }
  if (name === "c") {
    ui.openSettingsEditor("cycle", null, { ...ui.state.settingsDraft, ...cycleDraft(data.state.budgetCycle) })
    return
  }
}

function handleManagerMerchants(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name, sequence: seq } = key
  if (!data) return
  if (savedFilterKeys(ui, data, key)) return

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
  if (name === "/" || seq === "/") { ui.openFilter(data.state.filterQuery); return }
  if ((name === "return" || name === "enter") && group) {
    // Drill in: narrow the filter to this merchant and show its rows.
    const result = data.commitFilter(merchantFilter(data.state.filterQuery, group.merchant))
    if (!result.ok) { ui.setStatus(result.err, true); return }
    ui.setState({ txnView: "rows" })
    ui.jumpManagerCursor(0, data.scopedTransactions().length)
    ui.setStatus(`${group.merchant} · ${count(group.count, "transaction")} · u to widen`)
    return
  }
  if (name === "c" && group) { ui.openCatPicker(group.ids); return }
  if (name === "t" && group) { ui.openTagPicker(group.ids); return }
  if (name === "u" || name === "escape") {
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
  // / searches: the Transactions filter, opened from here (the Overview
  // itself is not filtered).
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
}
type ScopeEntry = {
  handle: (ui: UiStore, key: KeyEvent, data?: DataStore) => void
  hints: (state?: HintState) => { key: string; desc: string }[]
  quits: boolean
}

const scopes: Record<ScopeId, ScopeEntry> = {
  "filterPicker": {
    handle: handleFilterPicker,
    quits: false,
    hints: () => [{ key: "↑/↓", desc: "move" }, { key: "enter", desc: "apply" }, { key: "esc", desc: "close" }, { key: "type", desc: "filter" }],
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
      { key: "↑/↓", desc: "move" },
      { key: "space", desc: "stage" },
      { key: "enter", desc: "apply" },
      { key: "esc", desc: "cancel" },
    ],
  },
  "catPicker": {
    handle: handleCatPicker,
    quits: false,
    hints: () => [
      { key: "↑/↓", desc: "move" },
      { key: "enter", desc: "apply" },
      { key: "esc", desc: "cancel" },
      { key: "type", desc: "filter" },
    ],
  },
  "filter": {
    handle: handleFilter,
    quits: false,
    hints: () => [
      { key: "enter", desc: "apply" },
      { key: "esc", desc: "clear" },
      { key: "type", desc: "expr" },
      { key: "?…", desc: "ask in words" },
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
  "manager.accountAction": {
    handle: handleManagerAccountAction,
    quits: false,
    hints: () => [{ key: "c", desc: "clear txns" }, { key: "x", desc: "remove account" }, { key: "esc", desc: "cancel" }],
  },
  "settings.confirm": {
    handle: handleSettingsConfirm,
    quits: false,
    hints: () => [{ key: "del", desc: "confirm" }, { key: "esc", desc: "cancel" }],
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
    hints: () => [{ key: "j/k", desc: "profile" }, { key: "enter", desc: "select" }, { key: "a/e", desc: "new/edit" }, { key: "del", desc: "delete" }, { key: "esc", desc: "back" }],
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
      { key: "del", desc: "delete" }, { key: "esc", desc: "done" },
    ],
  },
  "settings.rules": {
    handle: handleSettingsRules,
    quits: true,
    hints: () => [
      { key: "j/k", desc: "move" }, { key: "space", desc: "toggle" },
      { key: "a", desc: "add" }, { key: "S-j/k", desc: "reorder" },
      { key: "S-a", desc: "apply" }, { key: "S-d", desc: "dry run" }, { key: "esc", desc: "done" },
    ],
  },
  "settings.filters": {
    handle: handleSettingsFilters,
    quits: true,
    hints: () => [{ key: "j/k", desc: "move" }, { key: "a", desc: "add" }, { key: "enter", desc: "edit" }, { key: "del", desc: "delete" }, { key: "esc", desc: "done" }],
  },
  "settings.up": {
    handle: handleSettingsUp,
    quits: true,
    hints: () => [{ key: "j/k", desc: "move" }, { key: "space", desc: "sync on/off" }, { key: "s", desc: "sync now" }, { key: "esc", desc: "done" }],
  },
  "settings.database": {
    handle: handleSettingsDatabase,
    quits: true,
    hints: () => [{ key: "i", desc: "import" }, { key: "p", desc: "profiles" }, { key: "n", desc: "icons" }, { key: "w", desc: "week start" }, { key: "b", desc: "x-axis line" }, { key: "c", desc: "clear data" }, { key: "x", desc: "reset DB" }, { key: "esc", desc: "done" }],
  },
  "manager.txns": {
    handle: handleManagerTxns,
    quits: true,
    hints: (state) => state?.uncategorisedOnly ? [
      { key: "y", desc: "accept" },
      { key: "Y", desc: `accept all ≥${ACCEPT_ALL_AT * 100}%` },
      { key: "x", desc: "dismiss" },
      { key: "c", desc: "choose" },
      { key: "space", desc: "select" },
      { key: "S-j/k", desc: "range" },
      { key: "j/k", desc: "move" },
      { key: "enter", desc: "detail" },
      { key: "m", desc: "merchants" },
      { key: "i", desc: "all rows" },
      { key: "/", desc: "filter" },
      { key: "v", desc: "jump" },
    ] : [
      { key: "ctrl+s", desc: "save filter" },
      { key: "ctrl+l", desc: "saved filters" },
      { key: "enter", desc: "detail" },
      { key: "j/k", desc: "move" },
      { key: "i", desc: "uncategorised" },
      { key: "m", desc: "merchants" },
      { key: "a", desc: "account" },
      { key: "S-j/k", desc: "range" },
      { key: "space", desc: "select" },
      { key: "c", desc: "cat" },
      { key: "t", desc: "tag" },
      { key: "s", desc: "sort" },
      { key: "S-s", desc: "reverse" },
      ...(state?.drillReturn ? [{ key: "esc", desc: "back" }, { key: "u", desc: "clear" }] : [{ key: "esc/u", desc: "clear" }]),
      { key: "/", desc: "filter" },
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
    hints: () => [{ key: "j/k", desc: "move" }, { key: "a", desc: "add" }, { key: "enter", desc: "edit" }, { key: "del", desc: "delete" }, { key: "c", desc: "cycle" }, { key: "esc", desc: "done" }],
  },
  "manager.merchants": {
    handle: handleManagerMerchants,
    quits: true,
    hints: () => [
      { key: "ctrl+s", desc: "save filter" },
      { key: "ctrl+l", desc: "saved filters" },
      { key: "enter", desc: "its transactions" },
      { key: "j/k", desc: "move" },
      { key: "c", desc: "category" },
      { key: "t", desc: "tags" },
      { key: "s", desc: "sort" },
      { key: "/", desc: "filter" },
      { key: "m", desc: "rows" },
      { key: "a", desc: "account" },
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
        { key: "H/L", desc: "bottom chart" },
        { key: "a", desc: "account" },
        { key: "d/D", desc: "range" },
        { key: "[ ]", desc: "prev/next" },
        { key: "0", desc: "now" },
        { key: "c", desc: "this cycle" },
        ...(state?.chartViews.some((i) => CHART_VIEWS[i]?.group === "Balances") ? [{ key: "z", desc: "$0 axis" }] : []),
        { key: "/", desc: "search" },
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

export function footerHints(scope: ScopeId, state?: HintState): { key: string; desc: string }[] {
  return scopes[scope].hints(state)
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
