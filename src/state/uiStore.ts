import { createStore } from "solid-js/store"
import {
  defaultTimeframe,
  type TimeframeState,
} from "../domain/timeframe"
import type { ImportPreview, ImportProfile } from "../domain/types"

export type TabId = "dashboard" | "manager" | "settings"

export type SectionId =
  | "none"
  | "dash.date"
  | "dash.cashflow"
  | "dash.composition"
  | "mgr.accounts"
  | "mgr.transactions"
  | "set.categories"
  | "set.tags"
  | "set.rules"
  | "set.filters"
  | "set.database"

export type ScopeId =
  | "global"
  | "jump"
  | "filter"
  | "catPicker"
  | "tagPicker"
  | "dashboard"
  | "dashboard.date"
  | "manager"
  | "manager.accounts"
  | "manager.txns"
  | "settings"
  | "settings.taxonomy"
  | "settings.rules"
  | "settings.filters"
  | "settings.database"
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
export type SettingsEditorKind = "category" | "tag" | "filter" | "rule"
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
  filterMode: boolean
  filterDraft: string
  catPickerOpen: boolean
  catPickerCursor: number
  catPickerQuery: string
  tagPickerOpen: boolean
  tagPickerCursor: number
  tagPickerQuery: string
  selectedIds: Record<number, boolean>
  rangeSelecting: boolean
  rangeAnchorId: number
  rangeCursorId: number
  settingsActive: boolean
  settingsSection: "taxonomy" | "rules" | "filters" | "database"
  taxonomyList: SettingsList
  categoryCursor: number
  categoryTop: number
  categoryVisible: number
  tagCursor: number
  tagTop: number
  tagVisible: number
  ruleCursor: number
  filterCursor: number
  settingsEditor: SettingsEditorKind | null
  settingsEditId: number | string | null
  settingsEditField: number
  settingsDraft: { name: string; color: string; categoryId: number | null; id: string; expr: string; savedFilterId: string; setCategoryId: number | null; addTagIds: number[] }
  settingsConfirm: { kind: "category" | "tag" | "rule" | "filter" | "profile" | "clearData" | "clearAccount" | "deleteAccount"; id: number | string; label: string } | null
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
  dashboard: "none",
  manager: "mgr.transactions",
  settings: "none",
}

export const JUMP_TARGETS: Record<TabId, JumpTarget[]> = {
  dashboard: [
    { key: "d", section: "dash.date", label: "Date Range" },
    { key: "n", section: "dash.cashflow", label: "Cashflow" },
    { key: "c", section: "dash.composition", label: "Composition" },
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
    { key: "d", section: "set.database", label: "Database & Import" },
  ],
}

export const TABS: { id: TabId; label: string; hotkey: string }[] = [
  { id: "dashboard", label: "Dashboard", hotkey: "1" },
  { id: "manager", label: "Manager", hotkey: "2" },
  { id: "settings", label: "Settings", hotkey: "3" },
]

function createUiStore() {
  const [state, setState] = createStore<UiState>({
    activeTab: "dashboard",
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
    filterMode: false,
    filterDraft: "",
    catPickerOpen: false,
    catPickerCursor: 0,
    catPickerQuery: "",
    tagPickerOpen: false,
    tagPickerCursor: 0,
    tagPickerQuery: "",
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
    settingsEditor: null,
    settingsEditId: null,
    settingsEditField: 0,
    settingsDraft: { name: "", color: "#94e2d5", categoryId: null, id: "", expr: "", savedFilterId: "", setCategoryId: null, addTagIds: [] },
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
      status: `Tab: ${tab}`,
      statusErr: false,
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
      status: "Jump mode · press target letter",
      statusErr: false,
    })
  }

  function cancelJump() {
    setState({
      jumpMode: false,
      focusedSection: state.jumpPreviousFocus,
      status: "Jump cancelled",
      statusErr: false,
    })
  }

  function applyJump(section: SectionId) {
    setState({
      jumpMode: false,
      focusedSection: section,
      status: `Focused ${section}`,
      statusErr: false,
    })
  }

  function activateSettings(section: UiState["settingsSection"], list: SettingsList = "categories", reset = false) {
    const updates: Partial<UiState> = { settingsActive: true, settingsSection: section, taxonomyList: list, focusedSection: section === "taxonomy" ? (list === "categories" ? "set.categories" : "set.tags") : section === "rules" ? "set.rules" : section === "filters" ? "set.filters" : "set.database", jumpMode: false, status: `${section === "taxonomy" ? list[0]!.toUpperCase() + list.slice(1) : section} active`, statusErr: false }
    if (reset && list === "categories") { updates.categoryCursor = 0; updates.categoryTop = 0 }
    if (reset && list === "tags") { updates.tagCursor = 0; updates.tagTop = 0 }
    setState(updates)
  }

  function leaveSettings() { setState({ settingsActive: false, settingsEditor: null, settingsConfirm: null, importStage: "none", status: "Settings · navigate sections", statusErr: false }) }
  function openSettingsEditor(kind: SettingsEditorKind, id: number | string | null, draft: UiState["settingsDraft"]) { setState({ settingsEditor: kind, settingsEditId: id, settingsEditField: 0, settingsDraft: draft, settingsConfirm: null, jumpMode: false }) }
  function closeSettingsEditor() { setState({ settingsEditor: null, settingsEditId: null, settingsEditField: 0 }) }
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

  function openCatPicker() {
    setState({
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

  function openTagPicker() {
    setState({
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

  function moveAccountCursor(delta: number, count: number) {
    if (count <= 0) {
      setState({ accountCursor: 0 })
      return
    }
    let cur = state.accountCursor + delta
    if (cur < 0) cur = 0
    if (cur >= count) cur = count - 1
    setState({ accountCursor: cur })
  }

  function setTimeframe(tf: TimeframeState) {
    setState({ timeframe: tf })
  }

  function setDashChipCursor(i: number) {
    setState({ dashChipCursor: i })
  }

  function activeScope(): ScopeId {
    if (state.jumpMode) return "jump"
    if (state.catPickerOpen) return "catPicker"
    if (state.tagPickerOpen) return "tagPicker"
    if (state.filterMode) return "filter"
    if (state.settingsEditor) return "settings.editor"
    if (state.settingsConfirm) return "settings.confirm"
    if (state.importStage === "files") return "settings.import.files"
    if (state.importStage === "path") return "settings.import.path"
    if (state.importStage === "profile") return "settings.import.profile"
    if (state.importStage === "profileEditor") return "settings.import.profileEditor"
    if (state.importStage === "preview") return "settings.import.preview"
    if (state.accountActionId != null) return "manager.accountAction"
    if (state.factoryResetOpen) return "settings.factoryReset"
    if (state.activeTab === "dashboard") {
      if (state.focusedSection === "dash.date") return "dashboard.date"
      return "dashboard"
    }
    if (state.activeTab === "manager") {
      if (state.focusedSection === "mgr.accounts") return "manager.accounts"
      return "manager.txns"
    }
    if (!state.settingsActive) return "settings"
    if (state.settingsSection === "taxonomy") return "settings.taxonomy"
    if (state.settingsSection === "rules") return "settings.rules"
    if (state.settingsSection === "filters") return "settings.filters"
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
    moveAccountCursor,
    setTimeframe,
    setDashChipCursor,
    activeScope,
  }
}

export type UiStore = ReturnType<typeof createUiStore>
export const ui = createUiStore()
