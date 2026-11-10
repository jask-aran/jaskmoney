type AccountType = "debit" | "credit"

type DataSource = "csv" | "up"

export interface Account {
  id: number
  name: string
  type: AccountType
  sortOrder: number
  isActive: boolean
  source: DataSource
  externalKind: string | null
  balance: number | null
  syncEnabled: boolean
}

type AccountRole = "spending" | "saver"

export function accountRole(account: Pick<Account, "externalKind">): AccountRole {
  return account.externalKind === "SAVER" ? "saver" : "spending"
}

export interface Category {
  id: number
  name: string
  color: string
  sortOrder: number
  isDefault: boolean
  parentId: number | null
  extId: string | null
  notSpending: boolean
  income: boolean
  budgetIgnored: boolean
}

export interface Tag {
  id: number
  name: string
  color: string
  categoryIds: number[]
  about: string | null
  sortOrder: number
  extId: string | null
}

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
  descriptionJoin?: boolean
  amountStrip: string
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

export interface BoughtItem { name: string; quantity: number; price: number | null }

export interface Transaction {
  id: number
  dateRaw: string
  dateISO: string
  amount: number
  description: string
  categoryId: number | null
  categoryName: string
  categoryGroup: string
  bought?: BoughtItem[]
  categoryColor: string
  notes: string
  importId: number | null
  accountId: number | null
  accountName: string
  tagNames: string[]
  tagColors: string[]
  tagIds: number[]
  source: DataSource
  status: "HELD" | "SETTLED" | null
  transactionType: string | null
  message: string | null
  rawText: string | null
  foreignAmount: string | null
  cardMethod: string | null
  createdMs: number | null
  transferAccountId: number | null
  internal: boolean
  excluded: boolean
  income: boolean
}

export interface CategorySuggestion {
  transactionId: number
  categoryId: number
  confidence: number
  source: "history" | "jev"
  ranked?: Array<{ categoryId: number; confidence: number }>
  knewBought?: boolean
}

export type SortColumn = "date" | "amount" | "description" | "category" | "account" | "confidence"

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
