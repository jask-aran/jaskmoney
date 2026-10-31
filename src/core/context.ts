import type { Db, TagInput } from "../db/client"
import type { Rule, RuleRunResult, SavedFilter, Transaction } from "../domain/types"
import type { TagCandidate } from "../domain/tagSuggest"
import type { createUpClient } from "../up/client"
import type { CoreState, Repeat } from "./protocol"

export type { Repeat, TagPatch } from "./protocol"

/** What an undo step reports: its summary, and for a tag review's dismissal,
 * the candidates it brought back (the client puts them back in its review). */
export interface UndoResult {
  message: string
  restored?: { review: number; tag: string; candidates: TagCandidate[] }
}

/** What the core's parts share. */
export interface CoreContext {
  readonly state: CoreState
  set: (patch: Partial<CoreState>) => void
  mutate: <T>(write: (db: Db) => T) => T
  refresh: () => void
  readonly db: Db | null
  readonly dbVersion: number
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
