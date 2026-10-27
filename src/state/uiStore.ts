import type { Armed } from "./armed"
import type { DryRunReport } from "../domain/rules"
import type { CycleAnchor, CycleUnit } from "../domain/budget"
import type { MerchantSort } from "../domain/merchants"
import { createStore, reconcile } from "solid-js/store"
import {
  defaultTimeframe,
  type TimeframeState,
} from "../domain/timeframe"
import type { ImportPreview, ImportProfile } from "../domain/types"
import type { TextField } from "../domain/textField"
import { editorFields } from "./settingsForm"

export type TabId = "overview" | "manager" | "settings"

export type SectionId =
  | "none"
  | "ov.range"
  | "ov.chart"
  | "ov.chart2"
  | "ov.categories"
  | "mgr.accounts"
  | "mgr.transactions"
  | "set.categories"
  | "set.tags"
  | "set.rules"
  | "set.filters"
  | "set.database"
  | "set.up"
  | "set.ai"
  | "set.budgets"

export type ScopeId =
  | "palette"
  | "filterPicker"
  | "dryRun"
  | "jump"
  | "filter"
  | "catPicker"
  | "tagChooser"
  | "tagPicker"
  | "overview"
  | "overview.range"
  | "overview.custom"
  | "manager.accounts"
  | "manager.txns"
  | "manager.merchants"
  | "settings"
  | "settings.taxonomy"
  | "settings.rules"
  | "settings.filters"
  | "settings.database"
  | "settings.up"
  | "settings.ai"
  | "settings.budgets"
  | "manager.detail"
  | "manager.detail.notes"
  | "settings.editor"
  | "settings.import.files"
  | "settings.import.path"
  | "settings.import.profile"
  | "settings.import.profileEditor"
  | "settings.import.preview"
  | "manager.accountAction"
  | "manager.acceptPreview"
  | "manager.ruleOffers"
  | "llmSignIn"
  | "settings.aiDialog"
  | "settings.factoryReset"

export type SettingsList = "categories" | "tags"
export type SettingsSection = "taxonomy" | "budgets" | "rules" | "filters" | "up" | "ai" | "database"
/** j/k order of Settings sections (wide layout: left column, then right). */
export const SETTINGS_SECTIONS: SettingsSection[] = ["taxonomy", "budgets", "ai", "rules", "filters", "up", "database"]

/** Each Settings section's name: its pane's title and the palette's. (Jump badges are shorter.) */
export const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = {
  taxonomy: "Taxonomy", budgets: "Budgets", ai: "AI models", rules: "Rules",
  filters: "Saved Filters", up: "Up Bank", database: "Database & Import",
}

export function settingsSectionFocus(section: SettingsSection, list: SettingsList = "categories"): SectionId {
  if (section === "taxonomy") return list === "categories" ? "set.categories" : "set.tags"
  return section === "rules" ? "set.rules" : section === "filters" ? "set.filters" : section === "up" ? "set.up" : section === "ai" ? "set.ai" : section === "budgets" ? "set.budgets" : "set.database"
}
export type SettingsEditorKind = "category" | "tag" | "filter" | "rule" | "budget" | "cycle" 
export type ImportStage = "none" | "files" | "path" | "profile" | "profileEditor" | "preview"

export interface JumpTarget {
  key: string
  section: SectionId
  label: string
}

export interface UiState {
  filterPicker: { query: string; cursor: number } | null
  /** The command palette (ctrl+k), over the scope it was opened from. */
  palette: { query: string; cursor: number; from: ScopeId; opened: number } | null
  /** The palette's last command, listed first next time (session only). */
  lastCommandId: string | null
  dryRunReport: DryRunReport | null
  dryRunScroll: number
  dryRunVisible: number
  activeTab: TabId
  focusedSection: SectionId
  jumpMode: boolean
  jumpPreviousFocus: SectionId
  status: string
  statusErr: boolean
  managerCursor: number
  managerTop: number
  managerVisible: number
  timeframe: TimeframeState
  dashChipCursor: number
  /** The Custom range dialog: two dates being typed, the focused one and
   * the last validation error. */
  customEdit: { start: TextField; end: TextField; field: 0 | 1; error: string } | null
  /** The Overview Categories card's cursor (an index into every category
   * line, groups and subcategories). */
  overviewCategoryCursor: number
  /** Set by a drill-down from the Overview: esc in Transactions restores the
   * filter it replaced and returns to the section it came from. Cleared on
   * leaving Transactions any other way. */
  drillReturn: { filter: string; focus: SectionId } | null
  /** Each chart pane's view: indexes into CHART_VIEWS, top pane first. */
  chartViews: [number, number]
  filterMode: boolean
  filterDraft: string
  filterCaret: number
  catPickerOpen: boolean
  catPickerCursor: number
  catPickerQuery: string
  /** Choosing a tag to find transactions for (T). */
  tagChooserOpen: boolean
  tagChooserCursor: number
  tagChooserQuery: string
  tagPickerOpen: boolean
  tagPickerApplying: boolean
  tagPickerCursor: number
  tagPickerPatch: Record<number, "add" | "remove">
  tagPickerQuery: string
  /** Transactions the open category or tag picker applies to. */
  pickerTargets: number[]
  selectedIds: Record<number, boolean>
  rangeSelecting: boolean
  rangeAnchorId: number
  rangeCursorId: number
  settingsActive: boolean
  settingsSection: SettingsSection
  taxonomyList: SettingsList
  categoryCursor: number
  categoryTop: number
  categoryVisible: number
  tagCursor: number
  tagTop: number
  tagVisible: number
  ruleCursor: number
  filterCursor: number
  /** Transactions table: rows, or the same rows grouped by merchant. */
  txnView: "rows" | "merchants"
  /** Merchant view cursor, scroll offset and order. */
  merchantCursor: number
  merchantTop: number
  merchantSort: MerchantSort
  merchantReverse: boolean
  /** Cursor in the Settings budget list. */
  budgetCursor: number
  /** Cursor in the Up Bank sync account list. */
  upCursor: number
  /** AI models pane: 0 Jev, 1 Workers AI. */
  aiCursor: number
  /** Transaction shown in the detail view; null when closed. */
  detailId: number | null
  detailNotesEditing: boolean
  detailNotesDraft: string
  detailNotesCaret: number
  settingsEditor: SettingsEditorKind | null
  settingsEditId: number | string | null
  settingsEditField: number
  settingsCaret: number
  /** The open list for a picker field of the settings editor. */
  formPicker: { query: string; cursor: number } | null
  settingsDraft: {
    name: string; color: string; categoryId: number | null; id: string; expr: string; savedFilterId: string; setCategoryId: number | null; addTagIds: number[]; notSpending: boolean
    /** Budget editor: scope key (see budgetScopes.scopeKey) and amount text. */
    scopeKey: string; amount: string
    /** Cycle editor. */
    unit: CycleUnit; anchor: CycleAnchor; anchorDate: string; payEarly: boolean
    /** API key editors: the key as typed (never rendered), and Workers AI's account id. */

  }
  /** A row waiting for its key again to do something destructive (state/armed). */
  armed: Armed | null
  /** Settings › Database's rows (DATABASE_ROWS), and the account data dialog's actions. */
  databaseCursor: number
  accountActionCursor: number
  importStage: ImportStage
  importDirectory: string
  importFiles: string[]
  importCursor: number
  importPath: string
  importPathCaret: number
  importProfileCursor: number
  importProfileManaging: boolean
  importProfileDraft: ImportProfile
  importProfileEditId: string | null
  importProfileField: number
  importProfileCaret: number
  importPreview: ImportPreview | null
  importPreviewCursor: number
  importPreviewShowAll: boolean
  importPreviewRules: boolean
  accountActionId: number | null
  /** The last smart search: the question asked and the filter it became.
   * It describes the filter only while the filter is still that expression
   * (`smartQuestionFor`). */
  smartQuestion: { question: string; expr: string } | null
  /** Accept-all's preview: the rows it would categorise, until confirmed. */
  acceptPreview: number[] | null
  /** Settings › AI models' dialog for one row (state/aiDialog): the action
   * at the cursor, a field being typed (a key, the account id, the model),
   * remove armed (enter again removes), and the last result. */
  aiDialog: {
    row: "jev" | "workersAi" | "openrouter" | "openai" | "up"
    cursor: number
    field: { action: "key" | "accountId" | "model"; value: string; caret: number } | null
    armed: boolean
    note: { text: string; ok: boolean | null } | null
    busy: boolean
  } | null
  /** A browser sign-in to the general model's provider (app/llmSignIn): the
   * address to open, what's happening, and the paste field when pi-ai asks. */
  llmSignIn: { provider: "openrouter" | "openai"; url: string | null; message: string; paste: { message: string; value: string; caret: number } | null } | null
  /** R: rules offered from repeated categorisations; the cursor among them. */
  ruleOffersOpen: boolean
  ruleOfferCursor: number
  factoryResetOpen: boolean
  factoryResetDraft: string
  factoryResetCaret: number
}

const TAB_DEFAULT_FOCUS: Record<TabId, SectionId> = {
  overview: "none",
  manager: "mgr.transactions",
  settings: "none",
}

/** The Overview's chart pane views, in h/l order, with the group each
 * belongs to (the pane's title and the strip's separators). Both panes offer
 * every view. */
export const CHART_VIEWS = [
  { view: "Cumulative", group: "Spending" },
  { view: "Daily", group: "Spending" },
  { view: "Weekly", group: "Spending" },
  { view: "Cash flow", group: "Cash flow" },
  { view: "Net position", group: "Balances" },
  { view: "Available", group: "Balances" },
  { view: "Savers", group: "Balances" },
  { view: "Calendar", group: "Calendar" },
  { view: "Subscriptions", group: "Subscriptions" },
] as const

export const JUMP_TARGETS: Record<TabId, JumpTarget[]> = {
  overview: [
    { key: "d", section: "ov.range", label: "Date Range" },
    { key: "t", section: "ov.chart", label: "Top chart" },
    { key: "b", section: "ov.chart2", label: "Bottom chart" },
    { key: "c", section: "ov.categories", label: "Categories" },
  ],
  manager: [
    { key: "a", section: "mgr.accounts", label: "Accounts" },
    { key: "t", section: "mgr.transactions", label: "Transactions" },
  ],
  settings: [
    { key: "c", section: "set.categories", label: "Categories" },
    { key: "t", section: "set.tags", label: "Tags" },
    { key: "r", section: "set.rules", label: "Rules" },
    { key: "f", section: "set.filters", label: "Filters" },
    { key: "b", section: "set.budgets", label: "Budgets" },
    { key: "u", section: "set.up", label: "Up Bank" },
    { key: "a", section: "set.ai", label: "AI models" },
    { key: "d", section: "set.database", label: "Database & Import" },
  ],
}

export const TABS: { id: TabId; label: string; hotkey: string }[] = [
  { id: "overview", label: "Overview", hotkey: "1" },
  { id: "manager", label: "Transactions", hotkey: "2" },
  { id: "settings", label: "Settings", hotkey: "3" },
]

/** Clamp a list cursor and scroll only when it crosses a window edge. */
function cursorWindow(cursor: number, top: number, count: number, visible: number): { cursor: number; top: number } {
  if (count <= 0) return { cursor: 0, top: 0 }
  cursor = Math.max(0, Math.min(count - 1, cursor))
  const vis = Math.max(1, visible)
  if (cursor < top) top = cursor
  if (cursor >= top + vis) top = cursor - vis + 1
  return { cursor, top: Math.max(0, top) }
}

/** No ids: one shared object, so "still nothing highlighted" changes nothing downstream. */
const NO_IDS: Record<number, boolean> = Object.freeze({}) as Record<number, boolean>

function createUiStore() {
  const initialState = (): UiState => ({
    activeTab: "overview",
    focusedSection: "none",
    jumpMode: false,
    jumpPreviousFocus: "none",
    status: "OpenTUI shell",
    statusErr: false,
    managerCursor: 0,
    managerTop: 0,
    managerVisible: 24,
    timeframe: defaultTimeframe(),
    dashChipCursor: 5,
    customEdit: null,
    overviewCategoryCursor: 0,
    drillReturn: null,
    chartViews: [0, 4],
    filterMode: false,
    filterDraft: "",
    filterCaret: 0,
    catPickerOpen: false,
    catPickerCursor: 0,
    catPickerQuery: "",
    tagChooserOpen: false,
    tagChooserCursor: 0,
    tagChooserQuery: "",
    tagPickerOpen: false, tagPickerApplying: false, tagPickerPatch: {},
    tagPickerCursor: 0,
    tagPickerQuery: "",
    pickerTargets: [],

    selectedIds: {},
    rangeSelecting: false,
    rangeAnchorId: 0,
    rangeCursorId: 0,
    settingsActive: false,
    settingsSection: "taxonomy",
    taxonomyList: "categories",
    categoryCursor: 0,
    categoryTop: 0,
    categoryVisible: 10,
    tagCursor: 0,
    tagTop: 0,
    tagVisible: 10,
    ruleCursor: 0,
    filterCursor: 0,
    upCursor: 0,
    aiCursor: 0,
    budgetCursor: 0,
    merchantCursor: 0,
    merchantTop: 0,
    txnView: "rows",
    merchantSort: "total",
    merchantReverse: false,
    detailId: null,
    detailNotesEditing: false,
    detailNotesDraft: "",
    detailNotesCaret: 0,
    filterPicker: null, palette: null, lastCommandId: null, dryRunReport: null, dryRunScroll: 0, dryRunVisible: 10,
    settingsEditor: null,
    settingsEditId: null,
    settingsEditField: 0,
    settingsCaret: 0,
    formPicker: null,
    settingsDraft: { name: "", color: "#94e2d5", categoryId: null, id: "", expr: "", savedFilterId: "", setCategoryId: null, addTagIds: [], notSpending: false, scopeKey: "overall", amount: "", unit: "month", anchor: "calendar", anchorDate: "", payEarly: false },
    armed: null,
    databaseCursor: 0,
    accountActionCursor: 0,
    importStage: "none",
    importDirectory: "",
    importFiles: [],
    importCursor: 0,
    importPath: "",
    importPathCaret: 0,
    importProfileCursor: 0,
    importProfileManaging: false,
    importProfileDraft: { id: "", name: "", account: "", accountType: "debit", importPrefix: "", hasHeader: true, delimiter: ",", dateColumn: 0, amountColumn: 1, descriptionColumns: [2], descriptionJoin: false, amountStrip: "$", dateFormat: "DMY" },
    importProfileEditId: null,
    importProfileField: 0,
    importProfileCaret: 0,
    importPreview: null,
    importPreviewCursor: 0,
    importPreviewShowAll: false,
    importPreviewRules: true,
    accountActionId: null,
    smartQuestion: null,
    acceptPreview: null,
    ruleOffersOpen: false,
    ruleOfferCursor: 0,
    llmSignIn: null,
    aiDialog: null,
    factoryResetOpen: false,
    factoryResetDraft: "",
    factoryResetCaret: 0,
  })
  const [state, setState] = createStore<UiState>(initialState())

  /** Test isolation only: restore initial UI state and discard session edits. */
  function reset() {
    setState(reconcile(initialState()))
  }

  function setStatus(text: string, isErr = false) {
    setState({ status: text, statusErr: isErr })
  }

  function switchTab(tab: TabId) {
    setState({
      activeTab: tab,
      drillReturn: null,
      customEdit: null,
      focusedSection: TAB_DEFAULT_FOCUS[tab],
      jumpMode: false,
      filterMode: false,
      catPickerOpen: false,
      tagChooserOpen: false, tagChooserQuery: "", tagChooserCursor: 0,
      tagPickerOpen: false, tagPickerApplying: false, tagPickerPatch: {},
      rangeSelecting: false,
      settingsActive: false,
      filterPicker: null, palette: null, dryRunReport: null, dryRunScroll: 0, dryRunVisible: 10,
      settingsEditor: null,
      armed: null,
      importStage: "none",
      accountActionId: null,
      acceptPreview: null,
      ruleOffersOpen: false,
      factoryResetOpen: false,
      factoryResetDraft: "", factoryResetCaret: 0,
    })
  }

  function cycleTab(delta: number) {
    const ids = TABS.map((t) => t.id)
    const i = ids.indexOf(state.activeTab)
    switchTab(ids[(i + delta + ids.length) % ids.length]!)
  }

  function enterJump() {
    if (state.jumpMode) {
      cancelJump()
      return
    }
    setState({
      jumpMode: true,
      jumpPreviousFocus: state.focusedSection,
      filterMode: false,
      catPickerOpen: false,
      tagPickerOpen: false, tagPickerApplying: false, tagPickerPatch: {},
    })
  }

  function cancelJump() {
    setState({
      jumpMode: false,
      focusedSection: state.jumpPreviousFocus,
    })
  }

  function applyJump(section: SectionId) {
    setState({
      jumpMode: false,
      focusedSection: section,
    })
  }

  function activateSettings(section: UiState["settingsSection"], list: SettingsList = "categories", reset = false) {
    const updates: Partial<UiState> = { settingsActive: true, settingsSection: section, taxonomyList: list, focusedSection: settingsSectionFocus(section, list), jumpMode: false }
    if (reset && list === "categories") { updates.categoryCursor = 0; updates.categoryTop = 0 }
    if (reset && list === "tags") { updates.tagCursor = 0; updates.tagTop = 0 }
    setState(updates)
  }

  function leaveSettings() { setState({ settingsActive: false, settingsEditor: null, armed: null, importStage: "none", status: "Settings · navigate sections", statusErr: false }) }
  function openSettingsEditor(kind: SettingsEditorKind, id: number | string | null, draft: UiState["settingsDraft"]) {
    const field = editorFields(kind, draft, { accounts: [], categories: [], tags: [], savedFilters: [] })[0]
    setState({ settingsEditor: kind, settingsEditId: id, settingsEditField: 0, formPicker: null, settingsDraft: draft, settingsCaret: field?.kind === "text" ? field.display.length : 0, armed: null, jumpMode: false })
  }
  function closeSettingsEditor() { setState({ settingsEditor: null, settingsEditId: null, settingsEditField: 0, settingsCaret: 0, formPicker: null }) }
  function arm(armed: Armed) { setState({ armed }) }
  function disarm() { if (state.armed) setState({ armed: null }) }

  function beginImport(directory: string, files: string[]) {
    setState({ importStage: "files", importDirectory: directory, importFiles: files, importCursor: 0, importPath: "", importPathCaret: 0, importProfileCursor: 0, importProfileManaging: false, importPreview: null, importPreviewCursor: 0, importPreviewShowAll: false, importPreviewRules: true, jumpMode: false })
  }
  function cancelImport() { setState({ importStage: "none", importPreview: null, importPath: "", importPathCaret: 0, importProfileEditId: null, importProfileManaging: false }) }
  function openProfileEditor(draft: ImportProfile, id: string | null) { setState({ importStage: "profileEditor", importProfileDraft: draft, importProfileEditId: id, importProfileField: 0, importProfileCaret: draft.id.length }) }

  function moveSettingsList(list: SettingsList, delta: number, count: number) {
    const cursorKey = list === "categories" ? "categoryCursor" : "tagCursor"
    const topKey = list === "categories" ? "categoryTop" : "tagTop"
    const visible = list === "categories" ? state.categoryVisible : state.tagVisible
    const { cursor, top } = cursorWindow(state[cursorKey] + delta, state[topKey], count, visible)
    setState({ [cursorKey]: cursor, [topKey]: top } as Pick<UiState, typeof cursorKey | typeof topKey>)
  }

  function clearFocus() {
    setState({ focusedSection: "none", status: "Focus cleared" })
  }

  function openFilter(seed = "") {
    setState({
      filterMode: true,
      filterDraft: seed,
      filterCaret: seed.length,
      catPickerOpen: false,
      tagPickerOpen: false, tagPickerApplying: false, tagPickerPatch: {},
      jumpMode: false,
      status: "Filter · type expr · enter apply · esc clear",
    })
  }

  function closeFilter(apply: boolean) {
    setState({ filterMode: false })
    return apply ? state.filterDraft : null
  }

  function openCatPicker(targets: number[]) {
    setState({
      pickerTargets: targets,
      catPickerOpen: true,
      catPickerCursor: 0,
      catPickerQuery: "",
      tagPickerOpen: false, tagPickerApplying: false, tagPickerPatch: {},
      filterMode: false,
      jumpMode: false,
      rangeSelecting: false,
      status: "Quick categorize · j/k · enter · esc",
    })
  }

  function closeCatPicker() {
    setState({ catPickerOpen: false, catPickerQuery: "", catPickerCursor: 0 })
  }

  function openTagPicker(targets: number[]) {
    setState({
      pickerTargets: targets,
      tagPickerOpen: true,
      tagPickerApplying: false,
      tagPickerPatch: {},
      tagPickerCursor: 0,
      tagPickerQuery: "",
      catPickerOpen: false,
      filterMode: false,
      jumpMode: false,
      rangeSelecting: false,
      status: "Quick tags · space stage · enter apply · esc cancel",
    })
  }

  function closeTagPicker() {
    setState({ tagPickerOpen: false, tagPickerApplying: false, tagPickerPatch: {}, tagPickerQuery: "", tagPickerCursor: 0 })
  }

  function clearSelection() {
    setState({ selectedIds: {}, rangeSelecting: false })
  }

  function toggleSelectedId(id: number) {
    const next = { ...state.selectedIds }
    if (next[id]) delete next[id]
    else next[id] = true
    setState({ selectedIds: next })
  }

  function setRangeFromMove(
    anchorId: number,
    cursorId: number,
    selecting: boolean,
  ) {
    setState({
      rangeSelecting: selecting,
      rangeAnchorId: anchorId,
      rangeCursorId: cursorId,
    })
  }

  function highlightedIds(rows: { id: number }[]): Record<number, boolean> {
    if (!state.rangeSelecting || rows.length === 0) return NO_IDS
    let a = rows.findIndex((r) => r.id === state.rangeAnchorId)
    let b = rows.findIndex((r) => r.id === state.rangeCursorId)
    if (a < 0) a = state.managerCursor
    if (b < 0) b = state.managerCursor
    if (a > b) [a, b] = [b, a]
    const out: Record<number, boolean> = {}
    for (let i = a; i <= b; i++) {
      const id = rows[i]?.id
      if (id != null) out[id] = true
    }
    return out
  }

  function moveManagerCursor(delta: number, rowCount: number) {
    const { cursor, top } = cursorWindow(state.managerCursor + delta, state.managerTop, rowCount, state.managerVisible)
    setState({ managerCursor: cursor, managerTop: top })
  }

  function jumpManagerCursor(index: number, rowCount: number) {
    const { cursor, top } = cursorWindow(index, state.managerTop, rowCount, state.managerVisible)
    setState({ managerCursor: cursor, managerTop: top })
  }

  function setTimeframe(tf: TimeframeState) {
    setState({ timeframe: tf })
  }

  function setDashChipCursor(i: number) {
    setState({ dashChipCursor: i })
  }

  /** Rows an action applies to: the open detail transaction, else the
   * highlighted range, else the selection, else the cursor row. */
  function targetIds(rows: { id: number }[]): number[] {
    if (state.detailId != null) return [state.detailId]
    const hl = Object.keys(highlightedIds(rows)).map(Number)
    if (hl.length) return hl
    const sel = Object.keys(state.selectedIds).map(Number)
    if (sel.length) return sel
    const row = rows[state.managerCursor]
    return row ? [row.id] : []
  }

  function activeScope(): ScopeId {
    if (state.palette) return "palette"
    if (state.filterPicker) return "filterPicker"
    if (state.dryRunReport) return "dryRun"
    if (state.jumpMode) return "jump"
    if (state.catPickerOpen) return "catPicker"
    if (state.tagPickerOpen) return "tagPicker"
    if (state.tagChooserOpen) return "tagChooser"
    if (state.filterMode) return "filter"
    if (state.detailId != null) return state.detailNotesEditing ? "manager.detail.notes" : "manager.detail"
    if (state.settingsEditor) return "settings.editor"
    if (state.importStage === "files") return "settings.import.files"
    if (state.importStage === "path") return "settings.import.path"
    if (state.importStage === "profile") return "settings.import.profile"
    if (state.importStage === "profileEditor") return "settings.import.profileEditor"
    if (state.importStage === "preview") return "settings.import.preview"
    if (state.accountActionId != null) return "manager.accountAction"
    if (state.acceptPreview) return "manager.acceptPreview"
    if (state.ruleOffersOpen) return "manager.ruleOffers"
    if (state.llmSignIn) return "llmSignIn"
    if (state.aiDialog) return "settings.aiDialog"
    if (state.factoryResetOpen) return "settings.factoryReset"
    if (state.customEdit) return "overview.custom"
    if (state.activeTab === "overview") return state.focusedSection === "ov.range" ? "overview.range" : "overview"
    if (state.activeTab === "manager") {
      if (state.focusedSection === "mgr.accounts") return "manager.accounts"
      return state.txnView === "merchants" ? "manager.merchants" : "manager.txns"
    }
    if (!state.settingsActive) return "settings"
    if (state.settingsSection === "taxonomy") return "settings.taxonomy"
    if (state.settingsSection === "rules") return "settings.rules"
    if (state.settingsSection === "filters") return "settings.filters"
    if (state.settingsSection === "up") return "settings.up"
    if (state.settingsSection === "ai") return "settings.ai"
    if (state.settingsSection === "budgets") return "settings.budgets"
    return "settings.database"
  }

  return {
    state,
    setState,
    reset,
    setStatus,
    switchTab,
    cycleTab,
    enterJump,
    cancelJump,
    applyJump,
    activateSettings,
    leaveSettings,
    openSettingsEditor,
    closeSettingsEditor,
    arm,
    disarm,
    beginImport,
    cancelImport,
    openProfileEditor,
    moveSettingsList,
    clearFocus,
    openFilter,
    closeFilter,
    openCatPicker,
    closeCatPicker,
    openTagPicker,
    closeTagPicker,
    clearSelection,
    toggleSelectedId,
    setRangeFromMove,
    highlightedIds,
    moveManagerCursor,
    jumpManagerCursor,
    setTimeframe,
    setDashChipCursor,
    activeScope,
    targetIds,
  }
}

export type UiStore = ReturnType<typeof createUiStore>
export const ui = createUiStore()

/** The smart-search question behind `filter` (the draft or applied text),
 * if it is still exactly the expression that question produced. */
export function smartQuestionFor(state: Pick<UiState, "smartQuestion">, filter: string): string | null {
  const q = state.smartQuestion
  return q && filter.trim() === q.expr.trim() ? q.question : null
}
