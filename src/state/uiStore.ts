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
  /** The theme picker: the theme at the cursor is shown while it is open. */
  themePicker: { cursor: number } | null
  /** Choosing a provider's model (app/modelPicker): the filter and the cursor among its matches. */
  modelPicker: { provider: "openrouter" | "openai"; query: string; cursor: number } | null
  /** The command palette (ctrl+k), over the scope it was opened from. */
  palette: { query: string; cursor: number; from: ScopeId; opened: number } | null
  /** The palette's last command, listed first next time (session only). */
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
  /** The Custom range dialog. `focus`: one of its stops (CustomFocus).
   * The calendar shows `view` around its `cursor` day; `mark` is a first
   * mark waiting for the second (which applies), with the fields' text
   * from before it (`before`) for esc to put back. */
  customEdit: {
    start: TextField; end: TextField; focus: CustomFocus; error: string
    view: CalendarView; cursor: string
    mark: { start: string; end: string } | null
    before: { start: string; end: string } | null
  } | null
  /** The Overview Categories card's cursor (an index into every category
   * line, groups and subcategories). */
  overviewCategoryCursor: number
  /** Set by a drill-down from the Overview: esc in Transactions restores the
   * filter it replaced and returns to the section it came from. Cleared on
   * leaving Transactions any other way. */
  drillReturn: { filter: string; focus: SectionId } | null
  /** Each chart pane's view: indexes into CHART_VIEWS, in CHART_SECTIONS'
   * order (top, bottom, then the grid's top right and bottom right). */
  chartViews: ChartViews
  /** How many chart panes the Overview shows: 4 (a 2×2 grid) when the
   * chart column is wide enough, 2 at its wide layout, 1 below it (the
   * Overview sets it from its size). Panes past it are off screen: their
   * keys and jumps act on the top one. */
  overviewCharts: OverviewCharts
  filterBar: { draft: string; caret: number } | null
  catPicker: { cursor: number; query: string } | null
  /** Choosing a tag to find transactions for (T). */
  tagChooser: { cursor: number; query: string } | null
  tagPicker: { cursor: number; query: string; patch: Record<number, "add" | "remove">; applying: boolean } | null
  /** Transactions the open category or tag picker applies to. */
  pickerTargets: number[]
  selectedIds: Record<number, boolean>
  range: { anchorId: number; cursorId: number } | null
  settingsActive: boolean
  settingsSection: SettingsSection
  taxonomyList: SettingsList
  /** Taxonomy: a row of categoryRows (state/taxonomyRows), and a tag. */
  categoryCursor: number
  tagCursor: number
  /** The category groups open in Taxonomy (ids); the rest show as one row. */
  taxonomyOpen: number[]
  /** Taxonomy rows in view: a page for pgup/pgdn (set by the pane). */
  taxonomyVisible: number
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
  /** Cursor in the Budgets tab's Set budgets pane (budgetSetupRows: the
   * overall budget, then the categories). */
  budgetCategoryCursor: number
  /** The Set budgets pane's open groups (category ids); closed by default. */
  budgetSetupOpen: number[]
  /** The Overview's Range pane's open category groups (ids); closed by default. */
  overviewOpen: number[]
  /** No budgets set yet (from the data, App): the Budgets tab opens on
   * Set budgets, its overall budget first, rather than Progress. */
  budgetsEmpty: boolean
  /** The Budgets tab's budget pane view: an index into BUDGET_VIEWS (the
   * Overview's spending views over the budget, and its subscriptions). */
  budgetChart: number
  /** The Budgets tab's cycle panes' views: indexes into CHART_VIEWS (the
   * Overview's, over the cycle shown), or the first's CATEGORIES (the
   * budgets list). The second shows full screen only. */
  budgetCycleViews: [number, number]
  /** How many cycle panes the Budgets tab shows (0, 1 or 2): set from its
   * size, as overviewCharts is. */
  budgetCyclePanes: 0 | 1 | 2
  /** The cycle the Budgets tab shows: 0 this one, -1 the one before, ... */
  budgetOffset: number
  /** Cursor in the Up Bank sync account list. */
  upCursor: number
  /** AI models pane: a row of aiPaneRows (the models, Executor, the uses). */
  aiCursor: number
  /** Transaction shown in the detail view; null when closed. */
  detail: { id: number; boughtTop: number; notes: { draft: string; caret: number } | null } | null
  settingsEditor: { kind: SettingsEditorKind; id: number | string | null; field: number; caret: number; picker: { query: string; cursor: number } | null; saving: boolean } | null
  settingsDraft: {
    name: string; color: string; categoryId: number | null; id: string; expr: string; savedFilterId: string; setCategoryId: number | null; addTagIds: number[]; notSpending: boolean
    /** Tag editor: its categories and what it is for. */
    categoryIds: number[]; about: string
    /** Budget editor: scope key (see budgetScopes.scopeKey) and amount text. */
    scopeKey: string; amount: string
    /** Cycle editor. */
    unit: CycleUnit; anchor: CycleAnchor; anchorDate: string; payEarly: boolean
  }
  /** A row waiting for its key again to do something destructive (state/armed). */
  armed: Armed | null
  /** Settings › Appearance rows (APPEARANCE_ROWS). */
  appearanceCursor: number
  /** Settings › Database rows (DATABASE_ROWS). */
  databaseCursor: number
  importWizard: { stage: ImportStage; directory: string; files: string[]; cursor: number; path: string; pathCaret: number; profileCursor: number; managing: boolean; profileDraft: ImportProfile; profileEditId: string | null; profileField: number; profileCaret: number; preview: ImportPreview | null; previewCursor: number; previewShowAll: boolean; previewRules: boolean; committing: boolean } | null
  accountAction: { id: number; cursor: number } | null
  /** The last smart search: the question asked and the filter it became.
   * It describes the filter only while the filter is still that expression
   * (`smartQuestionFor`). */
  smartQuestion: { question: string; expr: string; written?: Written } | null
  /** A smart search is writing the filter for the question in the bar. */
  smartWriting: boolean
  /** Accept-all's preview: the rows it would categorise, until confirmed. */
  acceptPreview: number[] | null
  /** Settings › AI models › Sources › Executor's dialog (app/executorSource):
   * the status as last read (null while reading), the action at the cursor,
   * the browser sign-in being waited on (its address), the last result. */
  executor: { status: ExecutorStatus | null; cursor: number; busy: string | null; waiting: string | null; note: { text: string; ok: boolean | null } | null } | null
  /** Executor's status as last read (the AI pane's Sources row). */
  executorStatus: ExecutorStatus | null
  /** Settings › Up Bank › Accounts: which Up accounts sync (cursor row). */
  upAccounts: { cursor: number } | null
  /** Settings › Database & Import › Import history: the first import shown. */
  importHistory: { top: number } | null
  /** The first-run setup, full screen (state/welcome). */
  welcome: WelcomeState | null
  /** Settings › AI models' dialog for one row (state/aiDialog): the action
   * at the cursor, a field being typed (a key, the account id, the model),
   * remove armed (enter again removes), and the last result. */
  aiDialog: {
    row: "jev" | "workersAi" | "openrouter" | "openai" | "up"
    cursor: number
    field: { action: "key" | "accountId" | "model"; value: string; caret: number } | null
    note: { text: string; ok: boolean | null } | null
    busy: boolean
  } | null
  /** A use's dialog (Settings › AI models › Suggestions, Search, Rules): the
   * action at the cursor and the last result. */
  aiUse: { use: "suggestions" | "search" | "rules"; cursor: number; note: { text: string; ok: boolean | null } | null } | null
  /** A query's view (ai/catalog): its exact request (app/sentPreview) once
   * built, or why it couldn't be; the first line shown, and how many lines
   * there are and fit (set by the view, which lays them out). */
  aiSent: { use: "suggestions" | "search" | "rules"; query: QueryId; part: SentPart | null; error: string | null; top: number; visible: number; lines: number } | null
  /** A browser sign-in to the general model's provider (app/llmSignIn): the
   * address to open, what's happening, and the paste field when pi-ai asks. */
  llmSignIn: { provider: "openrouter" | "openai"; url: string | null; message: string; paste: { message: string; value: string; caret: number } | null } | null
  /** R: rules offered from repeated categorisations; the cursor among them. */
  ruleOffers: { cursor: number; busy: boolean } | null
  factoryReset: { draft: string; caret: number; busy: boolean } | null
  /** Writing a note on a merchant (n in Merchants, N on a row): its name as
   * shown, and the text. */
  merchantNote: { merchant: string; draft: string; caret: number } | null
  /** F1 in the search bar: JQL (state/searchHelp), brief or full (m), its
   * first line shown, and how many lines fit (set by the dialog). */
  searchHelp: { full: boolean; top: number; visible: number } | null
}

/** The view in each of the Overview's chart panes (an index into CHART_VIEWS). */
export type ChartViews = [number, number, number, number]
export type OverviewCharts = 1 | 2 | 4

/** One opening of a dialog, held by work that finishes later (a save, a
 * test, a sign-in): it writes to that opening only. Once the dialog closed,
 * or another opened in its place, `patch` and `close` change nothing, where
 * a plain `setState(key, patch)` would bring a closed dialog back as a
 * fragment (Solid sets a path on null to the patch itself). */
export interface Opening<T> {
  /** Still this opening: not closed, not replaced. */
  readonly open: boolean
  patch(patch: Partial<T>): void
  close(): void
}

function createUiStore() {
  let statusId = 0
  // The initial entry is the same after each test-only reset.
  const initialStatusAt = Date.now()
  const initialState = (): UiState => initialUiState(initialStatusAt)
  const [state, setState] = createStore<UiState>(initialState())

  /** Test isolation only: restore initial UI state and discard session edits. */
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

/** The smart-search question behind `filter` (the draft or applied text),
 * if it is still exactly the expression that question produced. */
export function smartQuestionFor(state: Pick<UiState, "smartQuestion">, filter: string): string | null {
  const q = state.smartQuestion
  return q && filter.trim() === q.expr.trim() ? q.question : null
}
