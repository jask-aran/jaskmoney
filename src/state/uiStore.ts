import type { CycleAnchor, CycleUnit } from "../domain/budget"
import type { MerchantSort } from "../domain/merchants"
import { createStore } from "solid-js/store"
import {
  defaultTimeframe,
  type TimeframeState,
} from "../domain/timeframe"
import type { ImportPreview, ImportProfile } from "../domain/types"

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
  | "set.budgets"

export type ScopeId =
  | "global"
  | "jump"
  | "filter"
  | "catPicker"
  | "tagPicker"
  | "overview"
  | "overview.range"
  | "manager"
  | "manager.accounts"
  | "manager.txns"
  | "manager.merchants"
  | "settings"
  | "settings.taxonomy"
  | "settings.rules"
  | "settings.filters"
  | "settings.database"
  | "settings.up"
  | "settings.budgets"
  | "manager.detail"
  | "manager.detail.notes"
  | "settings.editor"
  | "settings.confirm"
  | "settings.import.files"
  | "settings.import.path"
  | "settings.import.profile"
  | "settings.import.profileEditor"
  | "settings.import.preview"
  | "manager.accountAction"
  | "settings.factoryReset"

export type SettingsList = "categories" | "tags"
export type SettingsSection = "taxonomy" | "budgets" | "rules" | "filters" | "up" | "database"
/** j/k order of Settings sections (wide layout: left column, then right). */
export const SETTINGS_SECTIONS: SettingsSection[] = ["taxonomy", "budgets", "rules", "filters", "up", "database"]

export function settingsSectionFocus(section: SettingsSection, list: SettingsList = "categories"): SectionId {
  if (section === "taxonomy") return list === "categories" ? "set.categories" : "set.tags"
  return section === "rules" ? "set.rules" : section === "filters" ? "set.filters" : section === "up" ? "set.up" : section === "budgets" ? "set.budgets" : "set.database"
}
export type SettingsEditorKind = "category" | "tag" | "filter" | "rule" | "budget" | "cycle"
export type ImportStage = "none" | "files" | "path" | "profile" | "profileEditor" | "preview"

export interface JumpTarget {
  key: string
  section: SectionId
  label: string
}

export interface UiState {
  activeTab: TabId
  focusedSection: SectionId
  jumpMode: boolean
  jumpPreviousFocus: SectionId
  status: string
  statusErr: boolean
  managerCursor: number
  managerTop: number
  managerVisible: number
  accountCursor: number
  timeframe: TimeframeState
  dashChipCursor: number
  /** Each chart pane's view: indexes into CHART_VIEWS, top pane first. */
  chartViews: [number, number]
  filterMode: boolean
  filterDraft: string
  catPickerOpen: boolean
  catPickerCursor: number
  catPickerQuery: string
  tagPickerOpen: boolean
  tagPickerCursor: number
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
  /** Transaction shown in the detail view; null when closed. */
  detailId: number | null
  detailNotesEditing: boolean
  detailNotesDraft: string
  settingsEditor: SettingsEditorKind | null
  settingsEditId: number | string | null
  settingsEditField: number
  /** The open list for a picker field of the settings editor. */
  formPicker: { query: string; cursor: number } | null
  settingsDraft: {
    name: string; color: string; categoryId: number | null; id: string; expr: string; savedFilterId: string; setCategoryId: number | null; addTagIds: number[]; notSpending: boolean
    /** Budget editor: scope key (see budgetScopes.scopeKey) and amount text. */
    scopeKey: string; amount: string
    /** Cycle editor. */
    unit: CycleUnit; anchor: CycleAnchor; anchorDate: string
  }
  settingsConfirm: { kind: "category" | "tag" | "rule" | "filter" | "profile" | "clearData" | "clearAccount" | "deleteAccount" | "desyncAccount" | "budget"; id: number | string; label: string } | null
  importStage: ImportStage
  importDirectory: string
  importFiles: string[]
  importCursor: number
  importPath: string
  importProfileCursor: number
  importProfileManaging: boolean
  importProfileDraft: ImportProfile
  importProfileEditId: string | null
  importProfileField: number
  importPreview: ImportPreview | null
  importPreviewCursor: number
  importPreviewTop: number
  importPreviewShowAll: boolean
  importPreviewRules: boolean
  accountActionId: number | null
  factoryResetOpen: boolean
  factoryResetDraft: string
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
] as const

export type ChartView = (typeof CHART_VIEWS)[number]["view"]

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
    { key: "d", section: "set.database", label: "Database & Import" },
  ],
}

export const TABS: { id: TabId; label: string; hotkey: string }[] = [
  { id: "overview", label: "Overview", hotkey: "1" },
  { id: "manager", label: "Transactions", hotkey: "2" },
  { id: "settings", label: "Settings", hotkey: "3" },
]

function createUiStore() {
  const [state, setState] = createStore<UiState>({
    activeTab: "overview",
    focusedSection: "none",
    jumpMode: false,
    jumpPreviousFocus: "none",
    status: "OpenTUI shell",
    statusErr: false,
    managerCursor: 0,
    managerTop: 0,
    managerVisible: 24,
    accountCursor: 0,
    timeframe: defaultTimeframe(),
    dashChipCursor: 5,
    chartViews: [0, 4],
    filterMode: false,
    filterDraft: "",
    catPickerOpen: false,
    catPickerCursor: 0,
    catPickerQuery: "",
    tagPickerOpen: false,
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
    budgetCursor: 0,
    merchantCursor: 0,
    merchantTop: 0,
    txnView: "rows",
    merchantSort: "total",
    merchantReverse: false,
    detailId: null,
    detailNotesEditing: false,
    detailNotesDraft: "",
    settingsEditor: null,
    settingsEditId: null,
    settingsEditField: 0,
    formPicker: null,
    settingsDraft: { name: "", color: "#94e2d5", categoryId: null, id: "", expr: "", savedFilterId: "", setCategoryId: null, addTagIds: [], notSpending: false, scopeKey: "overall", amount: "", unit: "month", anchor: "calendar", anchorDate: "" },
    settingsConfirm: null,
    importStage: "none",
    importDirectory: "",
    importFiles: [],
    importCursor: 0,
    importPath: "",
    importProfileCursor: 0,
    importProfileManaging: false,
    importProfileDraft: { id: "", name: "", account: "", accountType: "debit", importPrefix: "", hasHeader: true, delimiter: ",", dateColumn: 0, amountColumn: 1, descriptionColumns: [2], descriptionJoin: false, amountStrip: "$", dateFormat: "DMY" },
    importProfileEditId: null,
    importProfileField: 0,
    importPreview: null,
    importPreviewCursor: 0,
    importPreviewTop: 0,
    importPreviewShowAll: false,
    importPreviewRules: true,
    accountActionId: null,
    factoryResetOpen: false,
    factoryResetDraft: "",
  })

  function setStatus(text: string, isErr = false) {
    setState({ status: text, statusErr: isErr })
  }

  function switchTab(tab: TabId) {
    setState({
      activeTab: tab,
      focusedSection: TAB_DEFAULT_FOCUS[tab],
      jumpMode: false,
      filterMode: false,
      catPickerOpen: false,
      tagPickerOpen: false,
      rangeSelecting: false,
      settingsActive: false,
      settingsEditor: null,
      settingsConfirm: null,
      importStage: "none",
      accountActionId: null,
      factoryResetOpen: false,
      factoryResetDraft: "",
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
      tagPickerOpen: false,
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

  function leaveSettings() { setState({ settingsActive: false, settingsEditor: null, settingsConfirm: null, importStage: "none", status: "Settings · navigate sections", statusErr: false }) }
  function openSettingsEditor(kind: SettingsEditorKind, id: number | string | null, draft: UiState["settingsDraft"]) { setState({ settingsEditor: kind, settingsEditId: id, settingsEditField: 0, formPicker: null, settingsDraft: draft, settingsConfirm: null, jumpMode: false }) }
  function closeSettingsEditor() { setState({ settingsEditor: null, settingsEditId: null, settingsEditField: 0, formPicker: null }) }
  function armSettingsConfirm(confirm: NonNullable<UiState["settingsConfirm"]>) { setState({ settingsConfirm: confirm }) }
  function clearSettingsConfirm() { setState({ settingsConfirm: null }) }

  function beginImport(directory: string, files: string[]) {
    setState({ importStage: "files", importDirectory: directory, importFiles: files, importCursor: 0, importPath: "", importProfileCursor: 0, importProfileManaging: false, importPreview: null, importPreviewCursor: 0, importPreviewTop: 0, importPreviewShowAll: false, importPreviewRules: true, jumpMode: false })
  }
  function cancelImport() { setState({ importStage: "none", importPreview: null, importPath: "", importProfileEditId: null, importProfileManaging: false }) }
  function openProfileEditor(draft: ImportProfile, id: string | null) { setState({ importStage: "profileEditor", importProfileDraft: draft, importProfileEditId: id, importProfileField: 0 }) }

  function moveSettingsList(list: SettingsList, delta: number, count: number) {
    if (!count) { setState(list === "categories" ? { categoryCursor: 0, categoryTop: 0 } : { tagCursor: 0, tagTop: 0 }); return }
    const cursorKey = list === "categories" ? "categoryCursor" : "tagCursor"
    const topKey = list === "categories" ? "categoryTop" : "tagTop"
    const visible = list === "categories" ? state.categoryVisible : state.tagVisible
    const cursor = Math.max(0, Math.min(count - 1, state[cursorKey] + delta))
    let top = state[topKey]
    if (cursor < top) top = cursor
    if (cursor >= top + Math.max(1, visible)) top = cursor - Math.max(1, visible) + 1
    setState({ [cursorKey]: cursor, [topKey]: Math.max(0, top) } as Pick<UiState, typeof cursorKey | typeof topKey>)
  }

  function clearFocus() {
    setState({ focusedSection: "none", status: "Focus cleared" })
  }

  function openFilter(seed = "") {
    setState({
      filterMode: true,
      filterDraft: seed,
      catPickerOpen: false,
      tagPickerOpen: false,
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
      tagPickerOpen: false,
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
      tagPickerCursor: 0,
      tagPickerQuery: "",
      catPickerOpen: false,
      filterMode: false,
      jumpMode: false,
      rangeSelecting: false,
      status: "Quick tags · space toggle · enter done · esc",
    })
  }

  function closeTagPicker() {
    setState({ tagPickerOpen: false, tagPickerQuery: "", tagPickerCursor: 0 })
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
    if (!state.rangeSelecting || rows.length === 0) return {}
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
    if (rowCount <= 0) {
      setState({ managerCursor: 0, managerTop: 0 })
      return
    }
    let cur = state.managerCursor + delta
    if (cur < 0) cur = 0
    if (cur >= rowCount) cur = rowCount - 1
    let top = state.managerTop
    const vis = Math.max(1, state.managerVisible)
    if (cur < top) top = cur
    if (cur >= top + vis) top = cur - vis + 1
    if (top < 0) top = 0
    setState({ managerCursor: cur, managerTop: top })
  }

  function jumpManagerCursor(index: number, rowCount: number) {
    if (rowCount <= 0) {
      setState({ managerCursor: 0, managerTop: 0 })
      return
    }
    const cur = Math.max(0, Math.min(rowCount - 1, index))
    let top = state.managerTop
    const vis = Math.max(1, state.managerVisible)
    if (cur < top) top = cur
    if (cur >= top + vis) top = Math.max(0, cur - vis + 1)
    setState({ managerCursor: cur, managerTop: top })
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
    if (state.jumpMode) return "jump"
    if (state.catPickerOpen) return "catPicker"
    if (state.tagPickerOpen) return "tagPicker"
    if (state.filterMode) return "filter"
    if (state.detailId != null) return state.detailNotesEditing ? "manager.detail.notes" : "manager.detail"
    if (state.settingsEditor) return "settings.editor"
    if (state.settingsConfirm) return "settings.confirm"
    if (state.importStage === "files") return "settings.import.files"
    if (state.importStage === "path") return "settings.import.path"
    if (state.importStage === "profile") return "settings.import.profile"
    if (state.importStage === "profileEditor") return "settings.import.profileEditor"
    if (state.importStage === "preview") return "settings.import.preview"
    if (state.accountActionId != null) return "manager.accountAction"
    if (state.factoryResetOpen) return "settings.factoryReset"
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
    if (state.settingsSection === "budgets") return "settings.budgets"
    return "settings.database"
  }

  return {
    state,
    setState,
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
    armSettingsConfirm,
    clearSettingsConfirm,
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
