export type AccountType = "debit" | "credit"

export interface Account {
  id: number
  name: string
  type: AccountType
  sortOrder: number
  isActive: boolean
}

export interface Category {
  id: number
  name: string
  color: string
  sortOrder: number
  isDefault: boolean
}

export interface Tag {
  id: number
  name: string
  color: string
  categoryId: number | null
  sortOrder: number
}

export interface Transaction {
  id: number
  dateRaw: string
  dateISO: string
  amount: number
  description: string
  categoryId: number | null
  categoryName: string
  /** Hex from categories.color; empty/overlay1 = uncategorised mute. */
  categoryColor: string
  notes: string
  importId: number | null
  accountId: number | null
  accountName: string
  tagNames: string[]
  /** Parallel colours for tagNames (hex). */
  tagColors: string[]
  /** Tag ids parallel to tagNames. */
  tagIds: number[]
}

export type SortColumn = "date" | "amount" | "description" | "category" | "account"

export interface ImportRecord {
  id: number
  filename: string
  rowCount: number
  importedAt: string
}

export interface IngestResult {
  inserted: number
  skippedDupes: number
  accountId: number
  accountName: string
  importId: number
}
