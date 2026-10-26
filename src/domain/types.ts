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

/** A persisted, ordered classification rule. Filter definitions live in the
 * OpenTUI config so that rules can report a missing filter explicitly. */
export interface Rule {
  id: number
  name: string
  savedFilterId: string
  setCategoryId: number | null
  addTagIds: number[]
  sortOrder: number
  enabled: boolean
}

export interface SavedFilter {
  id: string
  name: string
  expr: string
}

export interface ImportProfile {
  id: string
  name: string
  account: string
  accountType: AccountType
  importPrefix: string
  hasHeader: boolean
  delimiter: string
  dateColumn: number
  amountColumn: number
  descriptionColumns: number[]
  /** Join every column from the first description column through the end. */
  descriptionJoin?: boolean
  amountStrip: string
  /** Explicit, deliberately small date vocabulary. New bank layouts are
   * mapped by the user instead of guessed from transaction data. */
  dateFormat: "DMY" | "MDY" | "YMD"
}

export interface ImportPreviewRow {
  sourceLine: number
  dateRaw: string
  dateISO: string
  amount: number
  description: string
  duplicate: boolean
  categoryName: string
  tagNames: string[]
}

export interface ImportPreviewError {
  sourceLine: number
  field: "csv" | "date" | "amount" | "columns"
  message: string
}

/** The immutable hand-off between scan and commit. No input file is read
 * again after this object has been created. */
export interface ImportPreview {
  path: string
  filename: string
  profile: ImportProfile
  accountId: number
  accountName: string
  rows: ImportPreviewRow[]
  errors: ImportPreviewError[]
  newCount: number
  duplicateCount: number
  rulesEnabled: boolean
}

export interface RuleRunResult {
  updatedTransactions: number
  categoryChanges: number
  tagChanges: number
  failedRules: string[]
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
  transactionIds: number[]
}
