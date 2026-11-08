import { APPEARANCE_ROWS } from "../../state/appearanceRows"
import { regionRects } from "../../ui/regions"
import { nearestRegion } from "../../state/spatial"
import { toggleDemo, applyAllRules, settleData, showDryRun, toggleIcons, toggleWeekStart, toggleXAxis, openThemePicker, toggleChartMotion, cycleChartSpeed, cycleChartCurve, toggleChartLabels, cycleOpenRange, cycleBackdrop } from "../actions"
import { DATABASE_ROWS } from "../../state/databaseRows"
import { type KeyEvent } from "@opentui/core"
import { budgetScopeOptions } from "../../domain/budgetScopes"
import { cycleFromDraft, editorFields, type FormField, normaliseCycleDraft, pickerChoices, pickerItems, stepChoice } from "../../state/settingsForm"
import { categoryRows } from "../../state/taxonomyRows"
import { SETTINGS_RIGHT, SETTINGS_SECTIONS, type SettingsSection, settingsSectionFocus, type ScopeId, type Opening, type SettingsEditorKind, type UiState, type UiStore } from "../../state/uiStore"
import type { DataStore } from "../../state/dataStore"
import { editText } from "../../domain/textField"
import { amountFromText } from "../../domain/typedInput"
import { nextSavedFilterId } from "../../state/settingsConfig"
import { queryPickerKey, listMove, shifted, confirmTwice, stackedMove, setGroupOpen, type ScopeEntry } from "./shared"
import { viewedBudgets } from "./budgets"

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

type Draft = UiState["settingsDraft"]
type EditorContext = Parameters<typeof editorFields>[2]
type EditorPicker = NonNullable<NonNullable<UiState["settingsEditor"]>["picker"]>

/** A picker field's list: arrows move, printable keys filter, enter
 * chooses (or toggles, for a multi-choice field), esc closes. */
function settingsEditorPicker(ui: UiStore, key: KeyEvent, kind: SettingsEditorKind, field: FormField, draft: Draft, ctx: EditorContext, picker: EditorPicker): void {
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
}

/** Save the editor's draft as its kind's record, then close; a bad draft throws. */
async function saveSettingsEditor(ui: UiStore, kind: SettingsEditorKind, id: number | string | null, draft: Draft, ctx: EditorContext, opened: Opening<NonNullable<UiState["settingsEditor"]>>, data?: DataStore): Promise<void> {
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
    } else if (kind === "pay") {
      // Empty clears it (0: not set).
      const amount = draft.amount.trim() ? amountFromText(draft.amount) : 0
      if (amount === null || amount < 0) throw new Error("enter what you expect each payday")
      await data?.saveUiPrefs({ expectedPay: amount })
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
    settingsEditorPicker(ui, key, kind, field, draft, ctx, picker)
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
    settleData(ui, saveSettingsEditor(ui, kind, id, draft, ctx, opened, data))
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

export const settingsScopes = {
  "settings.factoryReset": {
    handle: handleSettingsFactoryReset,
    list: false,
    hints: () => [{ key: "type RESET", desc: "confirm" }, { key: "enter", desc: "erase DB" }, { key: "esc", desc: "cancel" }],
  },
  "settings.editor": {
    handle: handleSettingsEditor,
    list: false,
    hints: () => [{ key: "↑/↓", desc: "field" }, { key: "←/→", desc: "change" }, { key: "enter", desc: "save / choose" }, { key: "esc", desc: "cancel" }],
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
} satisfies Partial<Record<ScopeId, ScopeEntry>>

