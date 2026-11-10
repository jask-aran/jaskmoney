import type { Category, Transaction } from "./types"

type FlowRow = Pick<Transaction, "tagNames"> & Partial<Pick<Transaction, "excluded">>
type MoneyRow = FlowRow & Pick<Transaction, "amount" | "categoryId" | "categoryName"> & Partial<Pick<Transaction, "income">>

export function hasIgnoreTag(row: Pick<Transaction, "tagNames">): boolean {
  return row.tagNames.some((tag) => tag.toUpperCase() === "IGNORE")
}

export function isOrdinaryFlow(row: FlowRow): boolean {
  return !row.excluded && !hasIgnoreTag(row)
}

export function incomeCategoryIds(categories: Pick<Category, "id" | "parentId" | "income">[]): Set<number> {
  const marked = new Set(categories.filter((c) => c.income).map((c) => c.id))
  return new Set(categories.filter((c) => marked.has(c.id) || (c.parentId != null && marked.has(c.parentId))).map((c) => c.id))
}

export function isUncategorised(row: Pick<Transaction, "categoryId" | "categoryName">): boolean {
  return row.categoryId == null || row.categoryName === "Uncategorised"
}

export function isSpending(row: MoneyRow): boolean {
  return isOrdinaryFlow(row) && !row.income && (row.amount < 0 || (row.amount > 0 && !isUncategorised(row)))
}

export function isIncome(row: MoneyRow): boolean {
  return isOrdinaryFlow(row) && !!row.income
}

export function isUnsortedIn(row: MoneyRow): boolean {
  return isOrdinaryFlow(row) && !row.income && row.amount > 0 && isUncategorised(row)
}

export function isHeld(row: Pick<Transaction, "status">): boolean {
  return row.status === "HELD"
}
