/**
 * The contract between the jaskmoney core (the server: the database, the
 * settings, the credentials, Up and the models) and its clients (the TUI,
 * the web app).
 *
 * A client mirrors `CoreState` from the patches the core sends (the first is
 * the whole state) and asks for changes with commands. Every command is a
 * call: a method name, one JSON params object, and a result or an error.
 * A long command can report progress, and a client can cancel it. The core
 * sends a command's state patches before its result, so when a call
 * resolves, the client's mirror already shows what it did.
 *
 * No runtime imports, so a browser bundle can use it.
 */
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

/** What the core owns, as every client sees it. */
export interface CoreState {
  ready: boolean
  /** Bumped each time the core opens a database (demo mode, a reset): a
   * client's per-database caches (ask verdicts, a tag review) go. */
  session: number
  /** Bumped by every write: anything read from the database is stale. */
  version: number
  upSyncing: boolean
  /** Demo mode: the app is on a database of made-up rows (enterDemo); the
   * real one is untouched, and sync is off. */
  demo: boolean
  suggesting: boolean
  /** Rules the general model proposed this session (R's list, after the repeat offers). */
  aiRuleOffers: RuleOffer[]
  /** The model is writing rules. */
  writingRules: boolean
  suggestions: Record<number, CategorySuggestion>
  merchantNotes: Record<string, string>
  /** Jev's merchant-breadth answers, by key (domain/history merchantKey). */
  merchantBreadth: Record<string, number>
  /** Repeated categorisations (rule offers are made from them). */
  categoryChoices: CategoryChoice[]
  /** Order-email lookups so far (app/purchases), by row. */
  purchaseLookups: Record<number, PurchaseLookup>
  /** Where each API key comes from, masked (`maskSecret`); never the key. */
  apiKeys: Record<CredentialName, { source: "saved" | "env" | null; mask: string }>
  /** Browser sign-ins to the general model's providers (oauth.json). */
  signedIn: Record<LlmProvider, boolean>
  /** How Jev is reached (a key or a sign-in), or null when it isn't set up. */
  jev: JevProvider | null
  /** Smart search asks Clairic (Workers AI) for words and dates too. */
  clairic: boolean
  /** The general model that writes rules, or null when none is set up. */
  llm: string | null
  /** An Up token is set: sync can run. */
  upToken: boolean
  dbPath: string
  accounts: Account[]
  /** Every provider-synced account, including ones whose sync is off. */
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
  /** Show Nerd Font category icons (settings config). */
  icons: boolean
  importProfiles: ImportProfile[]
  imports: ImportRecord[]
  transactions: Transaction[]
  dbInfo: DbInfo | null
  /** What undo would undo, or null. */
  undoLabel: string | null
  /** What `.` repeats on other rows. */
  lastRepeat: Repeat | null
  /** Where this core serves the web app and other clients (server/serve),
   * or null when it doesn't. The process, not the database: a switch of
   * database leaves it. */
  server: { page: string; api: string } | null
  /** Who is connected to it now, oldest first. */
  clients: ConnectedClient[]
}

/** A client of the core's server (server/clients describeClient). */
export interface ConnectedClient {
  id: number
  /** "web": a browser on the web app; "tui": a TUI with --connect. */
  kind: "web" | "tui"
  /** "Edge on Windows", "jaskmoney TUI". */
  agent: string
  /** Where it connects from: the visitor's address through the tunnel. */
  address: string
  /** Through the Cloudflare tunnel, or straight to the port. */
  via: "tunnel" | "direct"
  /** When it connected (epoch ms). */
  since: number
}

/** The state before a database is open. */
export function emptyCoreState(): CoreState {
  return {
    ready: false, session: 0, version: 0, upSyncing: false, demo: false, suggesting: false, aiRuleOffers: [], writingRules: false,
    suggestions: {}, merchantNotes: {}, merchantBreadth: {}, categoryChoices: [], purchaseLookups: {},
    apiKeys: {} as CoreState["apiKeys"], signedIn: { openrouter: false, openai: false }, jev: null, clairic: false, llm: null, upToken: false, dbPath: "",
    accounts: [], syncAccounts: [], budgets: [], budgetHistory: [],
    budgetCycle: { unit: "month", anchor: "calendar", anchorDate: null, payEarly: false },
    categories: [], tags: [], rules: [], savedFilters: [], icons: true, uiPrefs: {}, weekStart: "monday",
    server: null, clients: [],
    importProfiles: [], imports: [], transactions: [], dbInfo: null, undoLabel: null, lastRepeat: null,
  }
}

export type CoreMethod = keyof CoreCommands
export type CoreParams<M extends CoreMethod> = Parameters<CoreCommands[M]>[0]
export type CoreResult<M extends CoreMethod> = Awaited<ReturnType<CoreCommands[M]>>

/** The whole browser sign-in view, without credentials. */
export type SignInProgress = { url: string | null; message: string; paste: string | null }

/** What a long command reports as it goes. */
export interface CoreProgress {
  signInLlm: SignInProgress
  categorize: { pushed: number; total: number }
  acceptSuggestions: { pushed: number; total: number }
  /** Rows judged for an `ask:` term: [row id, how likely it matches]. */
  judgeAsk: Array<[number, number]>
  /** A tag's candidates: those known at once, then Jev's as they land. */
  tagCandidates: TagCandidate[]
}
export type ProgressOf<M extends CoreMethod> = M extends keyof CoreProgress ? CoreProgress[M] : never

/** Client → core. */
export type ClientMessage =
  | { t: "call"; id: number; method: string; params: unknown }
  | { t: "cancel"; id: number }

/** The slices a WebSocket sends by entry: a write changes a few of their
 * thousands of entries, so only those go (server/serve, client/wsLink). */
export const KEYED_SLICES = ["suggestions", "merchantNotes", "merchantBreadth", "purchaseLookups"] as const

/** Core → client. A state message's `patch` holds whole slices; `keyed`
 * the entries of KEYED_SLICES that changed or went; `rows` the
 * transactions that changed or went, and their order when it changed. */
export type ServerMessage =
  | {
    t: "state"
    patch: Partial<CoreState>
    keyed?: Partial<Record<(typeof KEYED_SLICES)[number], { set: Record<string, unknown>; remove: string[] }>>
    rows?: { set: CoreState["transactions"]; remove: number[]; order?: number[] }
  }
  | { t: "progress"; id: number; data: unknown }
  | { t: "result"; id: number; value?: unknown; error?: string }
