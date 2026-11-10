import type { WelcomeState } from "./welcome"
import type { CalendarView, CustomFocus } from "../domain/rangeCalendar"
import type { ExecutorStatus } from "../ai/executor"
import type { SentPart } from "../app/sentPreview"
import type { QueryId } from "../ai/catalog"
import type { Written } from "../app/searchReport"
import type { Armed } from "./armed"
import type { StatusEntry } from "./statusLog"
import type { DryRunReport } from "../domain/rules"
import type { CycleAnchor, CycleUnit } from "../domain/budget"
import type { MerchantSort } from "../domain/merchants"
import { createStore, reconcile } from "solid-js/store"
import {
  type TimeframeState,
} from "../domain/timeframe"
import type { ImportPreview, ImportProfile } from "../domain/types"
import type { TextField } from "../domain/textField"

import { initialUiState } from "./uiInitial"
import { createFocusActions } from "./uiFocus"
import { createDialogActions, createPickerActions } from "./uiDialogs"
import { createSettingsActions } from "./uiSettings"
import { createCursorActions, createSelectionActions } from "./uiSelection"
export { SETTINGS_SECTIONS, SETTINGS_RIGHT, SETTINGS_SECTION_LABELS, settingsSectionFocus, TAB_DEFAULT_FOCUS, CHART_SECTIONS, chartPaneOf, chartViewsFrom, CHART_VIEWS, BUDGET_VIEWS, CYCLE_VIEWS, BUDGET_PANES, CATEGORIES, cycleViewsFor, cycleView, budgetListInPane, budgetsHome, jumpTargets, TABS } from "./uiTables"

export type TabId = "overview" | "manager" | "budgets" | "settings"

export type SectionId =
  | "none"
  | "ov.accounts"
  | `bar.${TabId}`
  | "bar.version"
  | "bar.sync"
  | "ov.range"
  | "ov.chart"
  | "ov.chart2"
  | "ov.chart3"
  | "ov.chart4"
  | "ov.categories"
  | "mgr.accounts"
  | "mgr.transactions"
  | "set.categories"
  | "set.tags"
  | "set.rules"
  | "set.filters"
  | "set.appearance"
  | "set.database"
  | "set.up"
  | "set.ai"
  | "bud.categories"
  | "bud.plan"
  | "bud.chart"
  | "bud.cycle"
  | "bud.cycle2"

export type ScopeId =
  | "bar"
  | "palette"
  | "filterPicker"
  | "themePicker"
  | "modelPicker"
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
  | "settings.appearance"
  | "settings.database"
  | "settings.up"
  | "settings.ai"
  | "settings.importHistory"
  | "budgets.categories"
  | "budgets.plan"
  | "budgets.chart"
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
  | "settings.executor"
  | "settings.aiUse"
  | "settings.aiSent"
  | "settings.upAccounts"
  | "settings.factoryReset"
  | "merchantNote"
  | "searchHelp"
  | "welcome"

type SettingsList = "categories" | "tags"
export type SettingsSection = "taxonomy" | "rules" | "filters" | "up" | "ai" | "appearance" | "database"
export type SettingsEditorKind = "category" | "tag" | "filter" | "rule" | "budget" | "cycle" | "pay"
type ImportStage = "files" | "path" | "profile" | "profileEditor" | "preview"

export interface UiState {
  filterPicker: { query: string; cursor: number } | null
  themePicker: { cursor: number } | null
  modelPicker: { provider: "openrouter" | "openai"; query: string; cursor: number } | null
  palette: { query: string; cursor: number; from: ScopeId; opened: number } | null
  lastCommandId: string | null
  dryRun: { report: DryRunReport; scroll: number; visible: number } | null
  activeTab: TabId
  focusedSection: SectionId
  jump: { previousFocus: SectionId } | null
  statusLog: StatusEntry[]
  readonly status: string
  readonly statusErr: boolean
  managerCursor: number
  managerTop: number
  managerVisible: number
  timeframe: TimeframeState
  dashChipCursor: number
  customEdit: {
    start: TextField; end: TextField; focus: CustomFocus; error: string
    view: CalendarView; cursor: string
    mark: { start: string; end: string } | null
    before: { start: string; end: string } | null
  } | null
  overviewCategoryCursor: number
  drillReturn: { filter: string; focus: SectionId } | null
  chartViews: ChartViews
  overviewCharts: OverviewCharts
  filterBar: { draft: string; caret: number } | null
  catPicker: { cursor: number; query: string } | null
  tagChooser: { cursor: number; query: string } | null
  tagPicker: { cursor: number; query: string; patch: Record<number, "add" | "remove">; applying: boolean } | null
  pickerTargets: number[]
  selectedIds: Record<number, boolean>
  range: { anchorId: number; cursorId: number } | null
  settingsActive: boolean
  settingsSection: SettingsSection
  taxonomyList: SettingsList
  categoryCursor: number
  tagCursor: number
  taxonomyOpen: number[]
  taxonomyVisible: number
  ruleCursor: number
  filterCursor: number
  txnView: "rows" | "merchants"
  merchantCursor: number
  merchantTop: number
  merchantSort: MerchantSort
  merchantReverse: boolean
  budgetCursor: number
  budgetCategoryCursor: number
  budgetSetupOpen: number[]
  overviewOpen: number[]
  budgetsEmpty: boolean
  budgetChart: number
  budgetCycleViews: [number, number]
  budgetCyclePanes: 0 | 1 | 2
  budgetOffset: number
  upCursor: number
  aiCursor: number
  detail: { id: number; boughtTop: number; notes: { draft: string; caret: number } | null } | null
  settingsEditor: { kind: SettingsEditorKind; id: number | string | null; field: number; caret: number; picker: { query: string; cursor: number } | null; saving: boolean } | null
  settingsDraft: {
    name: string; color: string; categoryId: number | null; id: string; expr: string; savedFilterId: string; setCategoryId: number | null; addTagIds: number[]; notSpending: boolean
    categoryIds: number[]; about: string
    scopeKey: string; amount: string
    unit: CycleUnit; anchor: CycleAnchor; anchorDate: string; payEarly: boolean
  }
  armed: Armed | null
  appearanceCursor: number
  databaseCursor: number
  importWizard: { stage: ImportStage; directory: string; files: string[]; cursor: number; path: string; pathCaret: number; profileCursor: number; managing: boolean; profileDraft: ImportProfile; profileEditId: string | null; profileField: number; profileCaret: number; preview: ImportPreview | null; previewCursor: number; previewShowAll: boolean; previewRules: boolean; committing: boolean } | null
  accountAction: { id: number; cursor: number } | null
  smartQuestion: { question: string; expr: string; written?: Written } | null
  smartWriting: boolean
  acceptPreview: number[] | null
  executor: { status: ExecutorStatus | null; cursor: number; busy: string | null; waiting: string | null; note: { text: string; ok: boolean | null } | null } | null
  executorStatus: ExecutorStatus | null
  upAccounts: { cursor: number } | null
  importHistory: { top: number } | null
  welcome: WelcomeState | null
  aiDialog: {
    row: "jev" | "workersAi" | "openrouter" | "openai" | "up"
    cursor: number
    field: { action: "key" | "accountId" | "model"; value: string; caret: number } | null
    note: { text: string; ok: boolean | null } | null
    busy: boolean
  } | null
  aiUse: { use: "suggestions" | "search" | "rules"; cursor: number; note: { text: string; ok: boolean | null } | null } | null
  aiSent: { use: "suggestions" | "search" | "rules"; query: QueryId; part: SentPart | null; error: string | null; top: number; visible: number; lines: number } | null
  llmSignIn: { provider: "openrouter" | "openai"; url: string | null; message: string; paste: { message: string; value: string; caret: number } | null } | null
  ruleOffers: { cursor: number; busy: boolean } | null
  factoryReset: { draft: string; caret: number; busy: boolean } | null
  merchantNote: { merchant: string; draft: string; caret: number } | null
  searchHelp: { full: boolean; top: number; visible: number } | null
}

export type ChartViews = [number, number, number, number]
export type OverviewCharts = 1 | 2 | 4

export interface Opening<T> {
  readonly open: boolean
  patch(patch: Partial<T>): void
  close(): void
}

function createUiStore() {
  let statusId = 0
  const initialStatusAt = Date.now()
  const initialState = (): UiState => initialUiState(initialStatusAt)
  const [state, setState] = createStore<UiState>(initialState())

  function reset() {
    setState(reconcile(initialState()))
  }

  function appendStatus(entry: StatusEntry): number {
    setState("statusLog", (log) => [...log, entry].slice(-500))
    return entry.id
  }

  function setStatus(text: string, isErr = false): number {
    return appendStatus({ id: ++statusId, at: Date.now(), text, level: isErr ? "error" : "info" })
  }

  function withdrawStatus(id: number): number {
    return appendStatus({ id: ++statusId, at: Date.now(), withdraws: id })
  }

  const focus = createFocusActions(state, setState, setStatus)
  const dialogs = createDialogActions(state, setState)
  const settings = createSettingsActions(state, setState, setStatus)
  const pickers = createPickerActions(state, setState, setStatus)
  const selection = createSelectionActions(state, setState)
  const cursors = createCursorActions(state, setState)

  return {
    state,
    setState,
    reset,
    setStatus,
    withdrawStatus,
    switchTab: focus.switchTab,
    opening: dialogs.opening,
    cycleTab: focus.cycleTab,
    enterJump: focus.enterJump,
    cancelJump: focus.cancelJump,
    applyJump: focus.applyJump,
    activateSettings: settings.activateSettings,
    leaveSettings: settings.leaveSettings,
    openSettingsEditor: settings.openSettingsEditor,
    closeSettingsEditor: settings.closeSettingsEditor,
    arm: settings.arm,
    disarm: settings.disarm,
    beginImport: settings.beginImport,
    cancelImport: settings.cancelImport,
    openProfileEditor: settings.openProfileEditor,
    clearFocus: focus.clearFocus,
    openFilter: pickers.openFilter,
    closeFilter: pickers.closeFilter,
    openCatPicker: pickers.openCatPicker,
    closeCatPicker: pickers.closeCatPicker,
    openTagPicker: pickers.openTagPicker,
    closeTagPicker: pickers.closeTagPicker,
    clearSelection: selection.clearSelection,
    toggleSelectedId: selection.toggleSelectedId,
    setRangeFromMove: selection.setRangeFromMove,
    highlightedIds: selection.highlightedIds,
    ensureRange: selection.ensureRange,
    forgetRows: selection.forgetRows,
    pruneRows: selection.pruneRows,
    moveManagerCursor: cursors.moveManagerCursor,
    jumpManagerCursor: cursors.jumpManagerCursor,
    setTimeframe: cursors.setTimeframe,
    setDashChipCursor: cursors.setDashChipCursor,
    activeScope: dialogs.activeScope,
    targetIds: selection.targetIds,
  }
}

export type UiStore = ReturnType<typeof createUiStore>
export const ui = createUiStore()

export function smartQuestionFor(state: Pick<UiState, "smartQuestion">, filter: string): string | null {
  const q = state.smartQuestion
  return q && filter.trim() === q.expr.trim() ? q.question : null
}
