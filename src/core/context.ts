import type { Db, TagInput } from "../db/client"
import type { Rule, RuleRunResult, SavedFilter, Transaction } from "../domain/types"
import type { TagCandidate } from "../domain/tagSuggest"
import type { createUpClient } from "../up/client"
import type { CoreState, Repeat } from "./protocol"

export type { Repeat, TagPatch } from "./protocol"

export interface UndoResult {
  message: string
  restored?: { review: number; tag: string; candidates: TagCandidate[] }
}

export interface Session {
  readonly id: number
  readonly db: Db
}

export interface CoreContext {
  readonly state: CoreState
  set: (patch: Partial<CoreState>) => void
  mutate: <T>(write: (db: Db) => T) => T
  mutateSession: <T>(session: Session, doing: string, write: (db: Db) => T, rows?: Iterable<number>) => T
  refresh: (rows?: Iterable<number>) => void
  readonly db: Db | null
  readonly dbVersion: number
  session: () => Session
  isCurrent: (session: Session) => boolean
  ensureCurrent: (session: Session, doing: string) => void
  transactions: () => Transaction[]
  upClient: () => ReturnType<typeof createUpClient>
  recordUndo: (label: string, reverse: () => Promise<string | UndoResult>) => void
  categorySnapshot: (assignments: Map<number, number>) => { id: number; categoryId: number | null; description: string }[]
  restoreCategories: (rows: { id: number; categoryId: number | null }[]) => Promise<string>
  setLastRepeat: (repeat: Repeat | null) => void
  createSettingsTag: (input: TagInput) => number
  saveSavedFilter: (filter: SavedFilter, originalId?: string) => void
  createSettingsRule: (input: Omit<Rule, "id" | "sortOrder">) => number
  applyRules: (transactionIds?: number[], dryRun?: boolean) => RuleRunResult
  deleteSettingsRule: (id: number) => void
  deleteSavedFilter: (id: string) => void
}
