import type { SetStoreFunction } from "solid-js/store"
import { unwrap } from "solid-js/store"
import type { Opening, ScopeId, UiState } from "./uiStore"
import { BUDGET_PANES } from "./uiTables"

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
export const ALL_CLOSED: Partial<UiState> = Object.assign({}, ...MODALS.map(({ key }) => ({ [key]: null })))

/** Nullable object fields, including the accept-all preview array. */
type DialogKey = {
  [K in keyof UiState]-?: null extends UiState[K]
    ? NonNullable<UiState[K]> extends object ? K : never
    : never
}[keyof UiState]

export function createDialogActions(state: UiState, setState: SetStoreFunction<UiState>) {
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
    if (state.activeTab === "budgets") return BUDGET_PANES.includes(state.focusedSection) ? "budgets.chart" : state.focusedSection === "bud.plan" ? "budgets.plan" : "budgets.categories"
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
    if (state.settingsSection === "appearance") return "settings.appearance"
    return "settings.database"
  }

  return { opening, activeScope }
}

export function createPickerActions(state: UiState, setState: SetStoreFunction<UiState>, setStatus: (text: string, isErr?: boolean) => number) {
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
  return { openFilter, closeFilter, openCatPicker, closeCatPicker, openTagPicker, closeTagPicker }
}
