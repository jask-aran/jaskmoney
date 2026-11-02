import type { WelcomeState } from "./welcome"
import type { CalendarView } from "../domain/rangeCalendar"
import type { ExecutorStatus } from "../ai/executor"
import type { SentPart } from "../app/sentPreview"
import type { QueryId } from "../ai/catalog"
import type { Written } from "../app/searchReport"
import type { Armed } from "./armed"
import { latestStatus, type StatusEntry } from "./statusLog"
import type { DryRunReport } from "../domain/rules"
import type { CycleAnchor, CycleUnit } from "../domain/budget"
import type { MerchantSort } from "../domain/merchants"
import { createStore, reconcile, unwrap } from "solid-js/store"
import {
  defaultTimeframe,
  type TimeframeState,
} from "../domain/timeframe"
import type { ImportPreview, ImportProfile } from "../domain/types"
import type { TextField } from "../domain/textField"
import { editorFields } from "./settingsForm"

export type TabId = "overview" | "manager" | "budgets" | "settings"

export type SectionId =
  | "none"
  | "ov.accounts"
  | `bar.${TabId}`
  | "bar.version"
  | "bar.web"
  | "bar.sync"
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
  | "set.appearance"
  | "set.database"
  | "set.up"
  | "set.ai"
  | "set.web"
  | "bud.list"
  | "bud.categories"

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
  | "settings.web"
  | "settings.importHistory"
  | "budgets"
  | "budgets.categories"
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

export type SettingsList = "categories" | "tags"
export type SettingsSection = "taxonomy" | "rules" | "filters" | "up" | "web" | "ai" | "appearance" | "database"
/** The panes in reading order (j/k between them): the wide layout's left
 * column (Taxonomy, Rules & Filters), then its right, row by row (Up Bank,
 * Web app beside it, AI models, Appearance, Database & Import beside it);
 * the one-column layouts stack them in the same order. One stop per pane:
 * Saved filters is entered from Rules (or f in jump). */
export const SETTINGS_SECTIONS: SettingsSection[] = ["taxonomy", "rules", "up", "web", "ai", "appearance", "database"]
/** The panes of the wide layout's right column (l goes to its first). */
export const SETTINGS_RIGHT: SettingsSection[] = ["up", "web", "ai", "appearance", "database"]

/** Each Settings section's name: its pane's title and the palette's. (Jump badges are shorter.) */
export const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = {
  taxonomy: "Taxonomy", ai: "AI models", rules: "Rules",
  filters: "Saved Filters", up: "Up Bank", web: "Web app", appearance: "Appearance", database: "Database & Import",
}

export function settingsSectionFocus(section: SettingsSection, list: SettingsList = "categories"): SectionId {
  if (section === "taxonomy") return list === "categories" ? "set.categories" : "set.tags"
  return section === "rules" ? "set.rules" : section === "filters" ? "set.filters" : section === "up" ? "set.up" : section === "web" ? "set.web" : section === "ai" ? "set.ai" : section === "appearance" ? "set.appearance" : "set.database"
}
export type SettingsEditorKind = "category" | "tag" | "filter" | "rule" | "budget" | "cycle" 
export type ImportStage = "files" | "path" | "profile" | "profileEditor" | "preview"

export interface JumpTarget {
  key: string
  section: SectionId
  label: string
}

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
  /** The Custom range dialog: two dates being typed, the focused one and
   * the last validation error. */
  /** The Custom range dialog. `field`: Start, End, or the calendar (2).
   * The calendar shows `view` around its `cursor` day; `mark` is a first
   * mark waiting for the second (which applies), with the fields' text
   * from before it (`before`) for esc to put back. */
  customEdit: {
    start: TextField; end: TextField; field: 0 | 1 | 2; error: string
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
  /** Each chart pane's view: indexes into CHART_VIEWS, top pane first. */
  chartViews: [number, number]
  /** How many chart panes the Overview shows: 2 at its wide layout, 1
   * below it (the Overview sets it from its width). With one, the bottom
   * chart's keys and jump act on the top one. */
  overviewCharts: 1 | 2
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
  /** The Budgets tab's category list (domain/budgetLines order). */
  budgetCategoryCursor: number
  /** The Budgets tab's chart view: an index into BUDGET_VIEWS (the
   * Overview's spending views). */
  budgetChart: number
  /** The cycle the Budgets tab shows: 0 this one, -1 the one before, ... */
  budgetOffset: number
  /** Cursor in the Up Bank sync account list. */
  upCursor: number
  /** AI models pane: 0 Jev, 1 Workers AI. */
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
    /** API key editors: the key as typed (never rendered), and Workers AI's account id. */

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
  /** Settings › AI models' dialog for one row (state/aiDialog): the action
   * at the cursor, a field being typed (a key, the account id, the model),
   * remove armed (enter again removes), and the last result. */
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

export const TAB_DEFAULT_FOCUS: Record<TabId, SectionId> = {
  overview: "none",
  manager: "mgr.transactions",
  budgets: "bud.list",
  settings: "none",
}

/** The Overview's chart pane views, in h/l order, with the group each
 * belongs to (the pane's title and the strip's separators). Both panes offer
 * every view. `ranged`: drawn from the Date Range's days (Subscriptions is
 * the scope's whole history, whatever the range). */
export const CHART_VIEWS = [
  { view: "Cumulative", group: "Spending", ranged: true },
  { view: "Daily", group: "Spending", ranged: true },
  { view: "Weekly", group: "Spending", ranged: true },
  { view: "Cash flow", group: "Cash flow", ranged: true },
  { view: "Net position", group: "Balances", ranged: true },
  { view: "Available", group: "Balances", ranged: true },
  { view: "Savers", group: "Balances", ranged: true },
  { view: "Calendar", group: "Calendar", ranged: true },
  { view: "Subscriptions", group: "Subscriptions", ranged: false },
] as const

/** The Budgets tab's chart views: the Overview's spending ones, over the
 * cycle the tab shows. */
export const BUDGET_VIEWS = CHART_VIEWS.filter((v) => v.group === "Spending")

/** The tab's jump targets that are on screen: no bottom chart when the
 * Overview shows one chart. */
export function jumpTargets(state: Pick<UiState, "activeTab" | "overviewCharts">): JumpTarget[] {
  const targets = JUMP_TARGETS[state.activeTab]
  return state.activeTab === "overview" && state.overviewCharts === 1 ? targets.filter((t) => t.section !== "ov.chart2") : targets
}

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
  budgets: [
    { key: "b", section: "bud.list", label: "Budgets" },
    { key: "c", section: "bud.categories", label: "Categories" },
  ],
  settings: [
    { key: "c", section: "set.categories", label: "Categories" },
    { key: "t", section: "set.tags", label: "Tags" },
    { key: "r", section: "set.rules", label: "Rules" },
    { key: "f", section: "set.filters", label: "Filters" },
    { key: "u", section: "set.up", label: "Up Bank" },
    { key: "w", section: "set.web", label: "Web app" },
    { key: "a", section: "set.ai", label: "AI models" },
    { key: "p", section: "set.appearance", label: "Appearance" },
    { key: "d", section: "set.database", label: "Database & Import" },
  ],
}

export const TABS: { id: TabId; label: string; hotkey: string }[] = [
  { id: "overview", label: "Overview", hotkey: "1" },
  { id: "manager", label: "Transactions", hotkey: "2" },
  { id: "budgets", label: "Budgets", hotkey: "3" },
  { id: "settings", label: "Settings", hotkey: "4" },
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

/** A dialog key and its scope while open. */
type Modal = {
  [K in DialogKey]: { key: K; scope: (value: NonNullable<UiState[K]>) => ScopeId }
}[DialogKey]

/** Every dialog, in input precedence order. Tab switches close them all. */
const MODALS = [
  { key: "palette", scope: () => "palette" },
  { key: "searchHelp", scope: () => "searchHelp" },
  { key: "filterPicker", scope: () => "filterPicker" },
  { key: "themePicker", scope: () => "themePicker" },
  { key: "modelPicker", scope: () => "modelPicker" },
  { key: "dryRun", scope: () => "dryRun" },
  { key: "jump", scope: () => "jump" },
  { key: "catPicker", scope: () => "catPicker" },
  { key: "tagPicker", scope: () => "tagPicker" },
  { key: "tagChooser", scope: () => "tagChooser" },
  { key: "filterBar", scope: () => "filter" },
  { key: "merchantNote", scope: () => "merchantNote" },
  { key: "detail", scope: (value) => value.notes ? "manager.detail.notes" : "manager.detail" },
  { key: "settingsEditor", scope: () => "settings.editor" },
  { key: "importWizard", scope: (value) => `settings.import.${value.stage}` },
  { key: "accountAction", scope: () => "manager.accountAction" },
  { key: "acceptPreview", scope: () => "manager.acceptPreview" },
  { key: "ruleOffers", scope: () => "manager.ruleOffers" },
  { key: "llmSignIn", scope: () => "llmSignIn" },
  { key: "aiSent", scope: () => "settings.aiSent" },
  { key: "aiUse", scope: () => "settings.aiUse" },
  { key: "aiDialog", scope: () => "settings.aiDialog" },
  { key: "executor", scope: () => "settings.executor" },
  { key: "upAccounts", scope: () => "settings.upAccounts" },
  { key: "importHistory", scope: () => "settings.importHistory" },
  { key: "factoryReset", scope: () => "settings.factoryReset" },
  { key: "customEdit", scope: () => "overview.custom" },
  // Under every dialog: a sign-in or key dialog it opens takes the keys.
  { key: "welcome", scope: () => "welcome" },
] satisfies Modal[]

/** What closing every dialog writes. */
const ALL_CLOSED: Partial<UiState> = Object.assign({}, ...MODALS.map(({ key }) => ({ [key]: null })))

/** Nullable object fields, including the accept-all preview array. */
export type DialogKey = {
  [K in keyof UiState]-?: null extends UiState[K]
    ? NonNullable<UiState[K]> extends object ? K : never
    : never
}[keyof UiState]

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

/** No ids: one shared object, so "still nothing highlighted" changes nothing downstream. */
const NO_IDS: Record<number, boolean> = Object.freeze({}) as Record<number, boolean>

function createUiStore() {
  let statusId = 0
  // The initial entry is the same after each test-only reset.
  const initialStatusAt = Date.now()
  const initialState = (): UiState => ({
    activeTab: "overview",
    focusedSection: "none",
    jump: null,
    statusLog: [{ id: 0, at: initialStatusAt, text: "OpenTUI shell", level: "info" }],
    get status() { return latestStatus(this.statusLog).text },
    get statusErr() { return latestStatus(this.statusLog).level === "error" },
    managerCursor: 0,
    managerTop: 0,
    managerVisible: 24,
    timeframe: defaultTimeframe(),
    dashChipCursor: 5,
    customEdit: null,
    overviewCategoryCursor: 0,
    drillReturn: null,
    chartViews: [0, 4],
    overviewCharts: 2,
    filterBar: null,
    catPicker: null,
    tagChooser: null,
    tagPicker: null,
    pickerTargets: [],
    selectedIds: {},
    range: null,
    settingsActive: false,
    settingsSection: "taxonomy",
    taxonomyList: "categories",
    categoryCursor: 0,
    tagCursor: 0,
    taxonomyOpen: [],
    taxonomyVisible: 10,
    ruleCursor: 0,
    filterCursor: 0,
    upCursor: 0,
    aiCursor: 0,
    budgetCursor: 0,
    budgetCategoryCursor: 0,
    budgetChart: 0,
    budgetOffset: 0,
    merchantCursor: 0,
    merchantTop: 0,
    txnView: "rows",
    merchantSort: "total",
    merchantReverse: false,
    detail: null,
    filterPicker: null,
    themePicker: null,
    modelPicker: null,
    palette: null,
    lastCommandId: null,
    dryRun: null,
    settingsEditor: null,
    settingsDraft: { name: "", color: "#94e2d5", categoryId: null, id: "", expr: "", savedFilterId: "", setCategoryId: null, addTagIds: [], notSpending: false, categoryIds: [], about: "", scopeKey: "overall", amount: "", unit: "month", anchor: "calendar", anchorDate: "", payEarly: false },
    armed: null,
    appearanceCursor: 0,
    databaseCursor: 0,
    accountAction: null,
    importWizard: null,
    smartQuestion: null,
    smartWriting: false,
    acceptPreview: null,
    ruleOffers: null,
    llmSignIn: null,
    aiDialog: null,
    executor: null,
    executorStatus: null,
    aiUse: null,
    aiSent: null,
    upAccounts: null,
    importHistory: null,
    welcome: null,
    factoryReset: null,
    merchantNote: null,
    searchHelp: null,
  })
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

  function switchTab(tab: TabId) {
    setState({
      ...ALL_CLOSED,
      activeTab: tab,
      drillReturn: null,
      focusedSection: TAB_DEFAULT_FOCUS[tab],
      range: null,
      settingsActive: false,
      armed: null,
    })
  }

  /** The dialog open at `key` now, for work that finishes later (Opening). */
  function opening<K extends DialogKey>(key: K): Opening<NonNullable<UiState[K]>> {
    const at = unwrap(state)[key]
    const open = () => at != null && unwrap(state)[key] === at
    return {
      get open() { return open() },
      patch: (patch) => { if (open()) (setState as (k: K, v: unknown) => void)(key, patch) },
      close: () => { if (open()) setState({ [key]: null } as Partial<UiState>) },
    }
  }

  function cycleTab(delta: number) {
    const ids = TABS.map((t) => t.id)
    const i = ids.indexOf(state.activeTab)
    switchTab(ids[(i + delta + ids.length) % ids.length]!)
  }

  function enterJump() {
    if (state.jump) {
      cancelJump()
      return
    }
    setState({
      jump: { previousFocus: state.focusedSection },
      filterBar: null,
      catPicker: null,
      tagPicker: null,
    })
  }

  function cancelJump() {
    setState({
      jump: null,
      focusedSection: (state.jump?.previousFocus ?? "none"),
    })
  }

  function applyJump(section: SectionId) {
    setState({
      jump: null,
      focusedSection: section,
    })
  }

  function activateSettings(section: UiState["settingsSection"], list: SettingsList = "categories", reset = false) {
    const updates: Partial<UiState> = { settingsActive: true, settingsSection: section, taxonomyList: list, focusedSection: settingsSectionFocus(section, list), jump: null }
    if (reset && list === "categories") updates.categoryCursor = 0
    if (reset && list === "tags") updates.tagCursor = 0
    setState(updates)
  }

  function leaveSettings() {
    setState({ settingsActive: false, settingsEditor: null, armed: null, importWizard: null })
    setStatus("Settings · navigate sections")
  }
  function openSettingsEditor(kind: SettingsEditorKind, id: number | string | null, draft: UiState["settingsDraft"]) {
    const field = editorFields(kind, draft, { accounts: [], categories: [], tags: [], savedFilters: [] })[0]
    setState({ settingsEditor: { kind, id, field: 0, picker: null, caret: field?.kind === "text" ? field.display.length : 0, saving: false }, settingsDraft: draft, armed: null, jump: null })
  }
  function closeSettingsEditor() { setState({ settingsEditor: null }) }
  function arm(armed: Armed) { setState({ armed }) }
  function disarm() { if (state.armed) setState({ armed: null }) }

  function beginImport(directory: string, files: string[]) {
    setState({ importWizard: { stage: "files", directory, files, cursor: 0, path: "", pathCaret: 0, profileCursor: 0, managing: false, profileDraft: { id: "", name: "", account: "", accountType: "debit", importPrefix: "", hasHeader: true, delimiter: ",", dateColumn: 0, amountColumn: 1, descriptionColumns: [2], descriptionJoin: false, amountStrip: "$", dateFormat: "DMY" }, profileEditId: null, profileField: 0, profileCaret: 0, preview: null, previewCursor: 0, previewShowAll: false, previewRules: true, committing: false }, jump: null })
  }
  function cancelImport() { setState({ importWizard: null }) }
  function openProfileEditor(draft: ImportProfile, id: string | null) { if (!state.importWizard) beginImport("", []); setState("importWizard", { stage: "profileEditor", profileDraft: draft, profileEditId: id, profileField: 0, profileCaret: draft.id.length }) }

  function clearFocus() {
    setState({ focusedSection: "none" })
    setStatus("Focus cleared")
  }

  function openFilter(seed = "") {
    setState({
      filterBar: { draft: seed, caret: seed.length },
      catPicker: null,
      tagPicker: null,
      jump: null,
    })
    setStatus("Search: JQL, or ? then words")
  }

  function closeFilter(apply: boolean) {
    const draft = state.filterBar?.draft ?? ""
    setState({ filterBar: null })
    return apply ? draft : null
  }

  function openCatPicker(targets: number[]) {
    setState({
      pickerTargets: targets,
      catPicker: { cursor: 0, query: "" },
      tagPicker: null,
      filterBar: null,
      jump: null,
      range: null,
    })
    setStatus("Quick categorize · j/k · enter · esc")
  }

  function closeCatPicker() {
    setState({ catPicker: null })
  }

  function openTagPicker(targets: number[]) {
    setState({
      pickerTargets: targets,
      tagPicker: { cursor: 0, query: "", patch: {}, applying: false },
      catPicker: null,
      filterBar: null,
      jump: null,
      range: null,
    })
    setStatus("Quick tags · space stage · enter apply · esc cancel")
  }

  function closeTagPicker() {
    setState({ tagPicker: null })
  }

  function clearSelection() {
    setState({ selectedIds: {}, range: null })
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
    setState({ range: selecting ? { anchorId, cursorId } : null })
  }

  function highlightedIds(rows: { id: number }[]): Record<number, boolean> {
    const range = state.range
    if (!range) return NO_IDS
    let a = rows.findIndex((r) => r.id === range.anchorId)
    let b = rows.findIndex((r) => r.id === range.cursorId)
    if (a < 0 || b < 0) return NO_IDS
    if (a > b) [a, b] = [b, a]
    const out: Record<number, boolean> = {}
    for (let i = a; i <= b; i++) {
      const id = rows[i]?.id
      if (id != null) out[id] = true
    }
    return out
  }

  /** A range exists only while both ends are in the shown rows. */
  function ensureRange(rows: { id: number }[]) {
    const range = state.range
    if (range && (!rows.some((row) => row.id === range.anchorId) || !rows.some((row) => row.id === range.cursorId))) {
      setState({ range: null })
    }
  }

  /** Another database can reuse row ids; no row target carries across. */
  function forgetRows() {
    setState({ selectedIds: {}, range: null, pickerTargets: [], detail: null, acceptPreview: null })
  }

  /** Data reloads remove targets only when their transactions no longer exist. */
  function pruneRows(existing: ReadonlySet<number>) {
    if (!Object.keys(state.selectedIds).some((id) => !existing.has(Number(id)))
      && !state.pickerTargets.some((id) => !existing.has(id))
      && (!state.detail || existing.has(state.detail.id))) return
    setState({
      selectedIds: Object.fromEntries(Object.entries(state.selectedIds).filter(([id]) => existing.has(Number(id)))),
      pickerTargets: state.pickerTargets.filter((id) => existing.has(id)),
      detail: state.detail && !existing.has(state.detail.id) ? null : state.detail,
    })
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
    if (state.detail) return [state.detail.id]
    const hl = Object.keys(highlightedIds(rows)).map(Number)
    if (hl.length) return hl
    const sel = Object.keys(state.selectedIds).map(Number)
    if (sel.length) return sel
    const row = rows[state.managerCursor]
    return row ? [row.id] : []
  }

  function activeScope(): ScopeId {
    for (const modal of MODALS) {
      const value = state[modal.key]
      if (value != null) {
        if (modal.key === "detail") return modal.scope(state.detail!)
        if (modal.key === "importWizard") return modal.scope(state.importWizard!)
        return modal.scope()
      }
    }
    if (state.focusedSection.startsWith("bar.")) return "bar"
    if (state.activeTab === "overview") return state.focusedSection === "ov.range" ? "overview.range" : "overview"
    if (state.activeTab === "budgets") return state.focusedSection === "bud.categories" ? "budgets.categories" : "budgets"
    if (state.activeTab === "manager") {
      if (state.focusedSection === "mgr.accounts") return "manager.accounts"
      return state.txnView === "merchants" ? "manager.merchants" : "manager.txns"
    }
    if (!state.settingsActive) return "settings"
    if (state.settingsSection === "taxonomy") return "settings.taxonomy"
    if (state.settingsSection === "rules") return "settings.rules"
    if (state.settingsSection === "filters") return "settings.filters"
    if (state.settingsSection === "up") return "settings.up"
    if (state.settingsSection === "web") return "settings.web"
    if (state.settingsSection === "ai") return "settings.ai"
    if (state.settingsSection === "appearance") return "settings.appearance"
    return "settings.database"
  }

  return {
    state,
    setState,
    reset,
    setStatus,
    withdrawStatus,
    switchTab,
    opening,
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
    ensureRange,
    forgetRows,
    pruneRows,
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
