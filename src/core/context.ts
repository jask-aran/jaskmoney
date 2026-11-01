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

/**
 * One open database, from the attach that opened it until the next (demo
 * mode on or off, a factory reset, open). Async work captures the session it
 * started on and checks it after each await (`isCurrent`, `ensureCurrent`), so
 * its writes never land on the database that replaced it. Its id is
 * CoreState.session, which tells clients to drop what they cached.
 */
export interface Session {
  readonly id: number
  readonly db: Db
}

/** What the core's parts share. */
export interface CoreContext {
  readonly state: CoreState
  set: (patch: Partial<CoreState>) => void
  mutate: <T>(write: (db: Db) => T) => T
  mutateSession: <T>(session: Session, doing: string, write: (db: Db) => T) => T
  /** Reload from the database; `rows`: only these transactions changed (core refresh). */
  refresh: (rows?: Iterable<number>) => void
  readonly db: Db | null
  readonly dbVersion: number
  /** The session open now; throws when no database is open. */
  session: () => Session
  isCurrent: (session: Session) => boolean
  /** Throws, naming what was `doing`, when `session` is no longer open. */
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
