import type { Models } from "@earendil-works/pi-ai"
import { unwrap } from "solid-js/store"
import type { AccountSelection } from "../domain/accountTree"
import type { BudgetScope, CycleConfig } from "../domain/budget"
import { matchingProfiles } from "../domain/profileMatch"
import type { RuleOffer } from "../domain/ruleOffers"
import type { HistoryData } from "../domain/aiHistory"
import type { JevClient } from "../ai/jev"
import type { Llm, LlmProvider } from "../ai/llm"
import type { CredentialName } from "../ai/credentials"
import type { PurchaseLookup, TagInput } from "../db/client"
import type { Category, ImportProfile, Rule, SavedFilter } from "../domain/types"
import type { UiPrefs } from "../state/settingsConfig"
import type { CoreParams, CoreResult, SignInProgress, TagPatch } from "../core/protocol"
import type { createMirror } from "./mirror"
import type { createViewControls } from "./view"
import type { DataState } from "./store"

type Core = ReturnType<typeof createMirror>["core"]
type SetAccountSelection = ReturnType<typeof createViewControls>["setAccountSelection"]

export function createClientCommands(state: DataState, core: Core, setAccountSelection: SetAccountSelection) {
  function profileMatches(path: string): ImportProfile[] {
    return matchingProfiles(unwrap(state.importProfiles), path.split(/[\\/]/).pop() ?? path)
  }

  const transactionDetail = (id: number) => core.link.call("transactionDetail", { id })

  async function ruleWriterInput(): Promise<{ history: HistoryData; declined: CoreResult<"ruleWriterInput">["declined"] }> {
    const { history, declined } = await core.link.call("ruleWriterInput", {})
    return { history: { ...history, categorySources: history.categorySources ? new Map(history.categorySources) : undefined }, declined }
  }

  let selectionBeforeDemo: AccountSelection | null = null

  async function enterDemo(): Promise<number> {
    if (state.demo) return core.link.call("enterDemo", {})
    selectionBeforeDemo = state.accountSelection
    const rows = core.link.call("enterDemo", {})
    setAccountSelection("all")
    return rows
  }

  async function leaveDemo(): Promise<void> {
    if (!state.demo) return
    await core.link.call("leaveDemo", {})
    setAccountSelection(selectionBeforeDemo ?? "all")
    selectionBeforeDemo = null
  }

  return { profileMatches, transactionDetail, ruleWriterInput, enterDemo, leaveDemo,
    undoLabel: () => state.undoLabel,
    lastRepeat: () => state.lastRepeat,
    repeatLast: (ids: number[]) => core.link.call("repeatLast", { ids }),
  }
}

export function createTransactionCommands(core: Core) {
  function suggestCategories(ids?: number[], ai?: Pick<JevClient, "judge">): Promise<string>
  function suggestCategories(ids: number[], ai: Pick<JevClient, "judge"> | undefined, options: { replace: true }): Promise<number>
  function suggestCategories(ids?: number[], ai?: Pick<JevClient, "judge">, options: { replace?: boolean } = {}): Promise<string | number> {
    return core.link.call("suggestCategories", { ids, replace: options.replace }, { ai })
  }

  function applyTagPatch(ids: number[], patch: TagPatch, how?: "picker" | "review" | "undo"): Promise<string> {
    return core.link.call("applyTagPatch", { ids, patch, how })
  }

  return {
    categorizeTransactions: (ids: number[], categoryId: number, onProgress?: (pushed: number, total: number) => void) =>
      core.link.call("categorize", { ids, categoryId }, { onProgress: (p) => onProgress?.(p.pushed, p.total) }),
    applyTagPatch,
    retryPendingCategories: () => core.link.call("retryPendingCategories", {}),
    retryPendingTags: () => core.link.call("retryPendingTags", {}),
    suggestCategories,
    resuggestLike: (ids: number[], ai?: Pick<JevClient, "judge">) => core.link.call("resuggestLike", { ids }, { ai }),
    setMerchantNote: (description: string, note: string, ai?: Pick<JevClient, "judge">) => core.link.call("setMerchantNote", { description, note }, { ai }),
    recordPurchases: (lookups: PurchaseLookup[], ai?: Pick<JevClient, "judge">, session?: number) => core.link.call("recordPurchases", { lookups, session }, { ai }),
    acceptSuggestions: (ids: number[], onProgress?: (pushed: number, total: number) => void) =>
      core.link.call("acceptSuggestions", { ids }, { onProgress: (p) => onProgress?.(p.pushed, p.total) }),
    dismissSuggestions: (ids: number[]) => core.link.call("dismissSuggestions", { ids }),
    updateTransactionNotes: (id: number, notes: string, ai?: Pick<JevClient, "judge">) => core.link.call("updateTransactionNotes", { id, notes }, { ai }),

  }
}

export function createSettingsCommands(core: Core) {
  function saveUiPrefs(patch: Partial<UiPrefs>, { soon = false } = {}): Promise<void> {
    return core.link.call("saveUiPrefs", { patch, soon })
  }

  return {
    saveApiKeys: (patch: Partial<Record<CredentialName, string | null>>) => core.link.call("saveApiKeys", { patch }),
    refreshApiKeys: () => core.link.call("refreshApiKeys", {}),
    findCloudflareAccount: () => core.link.call("findCloudflareAccount", {}),
    signInLlm: (provider: LlmProvider, onProgress: (p: SignInProgress) => void, signal?: AbortSignal, models?: Pick<Models, "login">) =>
      core.link.call("signInLlm", { provider }, { onProgress, signal, models }),
    signInPaste: (provider: LlmProvider, value: string) => core.link.call("signInPaste", { provider, value }),
    signOutLlm: (provider: LlmProvider) => core.link.call("signOutLlm", { provider }),

    createSettingsCategory: (input: Pick<Category, "name" | "color"> & { notSpending?: boolean }) => core.link.call("createCategory", { input }),
    updateSettingsCategory: (id: number, input: Pick<Category, "name" | "color"> & { notSpending?: boolean }) => core.link.call("updateCategory", { id, input }),
    setCategoryBudgetIgnored: (id: number, ignored: boolean) => core.link.call("setCategoryBudgetIgnored", { id, ignored }),
    deleteSettingsCategory: (id: number) => core.link.call("deleteCategory", { id }),
    createSettingsTag: (input: TagInput) => core.link.call("createTag", { input }),
    updateSettingsTag: (id: number, input: TagInput) => core.link.call("updateTag", { id, input }),
    deleteSettingsTag: (id: number) => core.link.call("deleteTag", { id }),
    createSettingsRule: (input: Omit<Rule, "id" | "sortOrder">) => core.link.call("createRule", { input }),
    updateSettingsRule: (rule: Rule) => core.link.call("updateRule", { rule }),
    deleteSettingsRule: (id: number) => core.link.call("deleteRule", { id }),
    reorderSettingsRule: (id: number, index: number) => core.link.call("reorderRule", { id, index }),
    toggleSettingsRule: (id: number, enabled: boolean) => core.link.call("toggleRule", { id, enabled }),
    applyRules: (ids?: number[], dryRun?: boolean) => core.link.call("applyRules", { ids, dryRun }),

    saveSavedFilter: (filter: SavedFilter, originalId?: string) => core.link.call("saveSavedFilter", { filter, originalId }),
    deleteSavedFilter: (id: string) => core.link.call("deleteSavedFilter", { id }),
    recordFilterUsage: (id: string) => core.link.call("recordFilterUsage", { id }),
    setIcons: (on: boolean) => core.link.call("setIcons", { on }),
    setWelcomed: (done: boolean) => core.link.call("setWelcomed", { done }),
    saveUiPrefs,
    saveImportProfile: (profile: ImportProfile, originalId?: string | null) => core.link.call("saveImportProfile", { profile, originalId }),
    deleteImportProfile: (id: string) => core.link.call("deleteImportProfile", { id }),

  }
}

export function createDataCommands(state: DataState, core: Core, setAccountSelection: SetAccountSelection) {
  return {
    importDirectory: () => core.link.call("importDirectory", {}),
    csvFiles: (directory: string) => core.link.call("csvFiles", { directory }),
    previewImport: (path: string, profile: ImportProfile) => core.link.call("previewImport", { path, profile }),
    commitPreview: (preview: CoreParams<"commitPreview">["preview"], skipDuplicates: boolean) => core.link.call("commitPreview", { preview, skipDuplicates }),
    syncUp: (off?: string[]) => core.link.call("syncUp", off ? { off } : {}),

    setAccountSync: (accountId: number, enabled: boolean) => core.link.call("setAccountSync", { accountId, enabled }),
    setBudget: (scope: BudgetScope, amount: number, from?: string, replaces?: BudgetScope) => core.link.call("setBudget", { scope, amount, from, replaces }),
    removeBudget: (scope: BudgetScope, from?: string) => core.link.call("removeBudget", { scope, from }),
    setBudgetCycle: (config: CycleConfig) => core.link.call("setBudgetCycle", { config }),
    clearDatabaseData: () => core.link.call("clearDatabaseData", {}),
    clearAccountData: (accountId: number) => core.link.call("clearAccountData", { accountId }),
    removeAccountData: async (accountId: number) => {
      const removed = await core.link.call("removeAccountData", { accountId })
      if (state.accountSelection === accountId) setAccountSelection("all")
      return removed
    },
    factoryResetDatabase: async () => {
      await core.link.call("factoryResetDatabase", {})
      setAccountSelection("all")
    },

    smartSearch: (query: string, descriptions: string[]) => core.link.call("smartSearch", { query, descriptions }),
    askForRules: (llm?: Llm, focus?: string) => core.link.call("askForRules", { focus }, { llm }),
    makeOfferedRule: (offer: RuleOffer) => core.link.call("makeOfferedRule", { offer }),
    declineRuleOffer: (offer: RuleOffer) => core.link.call("declineRuleOffer", { offer }),
  }
}
