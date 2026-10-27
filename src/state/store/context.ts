import type { Setter } from "solid-js"
import type { SetStoreFunction } from "solid-js/store"
import type { Db } from "../../db/client"
import type { AskVerdict } from "../../domain/filter"
import type { Rule, RuleRunResult, SavedFilter, Tag, Transaction } from "../../domain/types"
import type { createUpClient } from "../../up/client"
import type { DataState } from "../dataStore"

export type TagPatch = Record<number, "add" | "remove">
export type Repeat = { kind: "category"; categoryId: number } | { kind: "tags"; patch: TagPatch }

export interface StoreContext {
  state: DataState
  setState: SetStoreFunction<DataState>
  mutate: <T>(write: (db: Db) => T) => T
  refresh: () => void
  readonly db: Db | null
  readonly dbVersion: number
  transactions: () => Transaction[]
  upClient: () => ReturnType<typeof createUpClient>
  recordUndo: (label: string, reverse: () => Promise<string>) => void
  categorySnapshot: (assignments: Map<number, number>) => { id: number; categoryId: number | null; description: string }[]
  restoreCategories: (rows: { id: number; categoryId: number | null }[]) => Promise<string>
  setLastRepeat: Setter<Repeat | null>
  askVerdicts: Map<string, Map<number, number>>
  setAskVersion: Setter<number>
  askRun: number
  askVerdict: AskVerdict<Transaction>
  accountScoped: () => Transaction[]
  inView: (t: Transaction) => boolean
  createSettingsTag: (input: Pick<Tag, "name" | "color" | "scope">) => number
  saveSavedFilter: (filter: SavedFilter, originalId?: string) => void
  createSettingsRule: (input: Omit<Rule, "id" | "sortOrder">) => number
  applyRules: (transactionIds?: number[], dryRun?: boolean) => RuleRunResult
  deleteSettingsRule: (id: number) => void
  deleteSavedFilter: (id: string) => void
}
