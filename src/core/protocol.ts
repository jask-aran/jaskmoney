import type { CategoryChoice, DbInfo, PurchaseLookup } from "../db/client"
import type { Budget, BudgetHistoryEntry, CycleConfig } from "../domain/budget"
import type { WeekStart } from "../domain/days"
import type { RuleOffer } from "../domain/ruleOffers"
import type { TagCandidate } from "../domain/tagSuggest"
import type { Account, Category, CategorySuggestion, ImportProfile, ImportRecord, Rule, SavedFilter, Tag, Transaction } from "../domain/types"
import type { CredentialName } from "../ai/credentials"
import type { LlmProvider } from "../ai/llm"
import type { JevProvider } from "../ai/jev"
import type { UiPrefs } from "../state/settingsConfig"
import type { CoreCommands } from "./core"

export type TagPatch = Record<number, "add" | "remove">
export type Repeat = { kind: "category"; categoryId: number } | { kind: "tags"; patch: TagPatch }

export interface CoreState {
  ready: boolean
  session: number
  version: number
  upSyncing: boolean
  demo: boolean
  suggesting: boolean
  aiRuleOffers: RuleOffer[]
  writingRules: boolean
  suggestions: Record<number, CategorySuggestion>
  merchantNotes: Record<string, string>
  merchantBreadth: Record<string, number>
  categoryChoices: CategoryChoice[]
  purchaseLookups: Record<number, PurchaseLookup>
  apiKeys: Record<CredentialName, { source: "saved" | "env" | null; mask: string }>
  signedIn: Record<LlmProvider, boolean>
  jev: JevProvider | null
  clairic: boolean
  llm: string | null
  upToken: boolean
  dbPath: string
  accounts: Account[]
  syncAccounts: Account[]
  budgets: Budget[]
  budgetHistory: BudgetHistoryEntry[]
  budgetCycle: CycleConfig
  categories: Category[]
  tags: Tag[]
  rules: Rule[]
  savedFilters: SavedFilter[]
  uiPrefs: UiPrefs
  weekStart: WeekStart
  icons: boolean
  welcomed: boolean
  importProfiles: ImportProfile[]
  imports: ImportRecord[]
  transactions: Transaction[]
  dbInfo: DbInfo | null
  undoLabel: string | null
  lastRepeat: Repeat | null
}

export function emptyCoreState(): CoreState {
  return {
    ready: false, session: 0, version: 0, upSyncing: false, demo: false, suggesting: false, aiRuleOffers: [], writingRules: false,
    suggestions: {}, merchantNotes: {}, merchantBreadth: {}, categoryChoices: [], purchaseLookups: {},
    apiKeys: {} as CoreState["apiKeys"], signedIn: { openrouter: false, openai: false }, jev: null, clairic: false, llm: null, upToken: false, dbPath: "",
    accounts: [], syncAccounts: [], budgets: [], budgetHistory: [],
    budgetCycle: { unit: "month", anchor: "calendar", anchorDate: null, payEarly: false },
    categories: [], tags: [], rules: [], savedFilters: [], icons: true, welcomed: false, uiPrefs: {}, weekStart: "monday",

    importProfiles: [], imports: [], transactions: [], dbInfo: null, undoLabel: null, lastRepeat: null,
  }
}

export type CoreMethod = keyof CoreCommands
export type CoreParams<M extends CoreMethod> = Parameters<CoreCommands[M]>[0]
export type CoreResult<M extends CoreMethod> = Awaited<ReturnType<CoreCommands[M]>>

export type SignInProgress = { url: string | null; message: string; paste: string | null }

export interface CoreProgress {
  signInLlm: SignInProgress
  categorize: { pushed: number; total: number }
  acceptSuggestions: { pushed: number; total: number }
  judgeAsk: Array<[number, number]>
  tagCandidates: TagCandidate[]
}
export type ProgressOf<M extends CoreMethod> = M extends keyof CoreProgress ? CoreProgress[M] : never

export type ClientMessage =
  | { t: "call"; id: number; method: string; params: unknown }
  | { t: "cancel"; id: number }

export const KEYED_SLICES = ["suggestions", "merchantNotes", "merchantBreadth", "purchaseLookups"] as const

export type ServerMessage =
  | {
    t: "state"
    patch: Partial<CoreState>
    keyed?: Partial<Record<(typeof KEYED_SLICES)[number], { set: Record<string, unknown>; remove: string[] }>>
    rows?: { set: CoreState["transactions"]; remove: number[]; order?: number[] }
  }
  | { t: "progress"; id: number; data: unknown }
  | { t: "result"; id: number; value?: unknown; error?: string }
