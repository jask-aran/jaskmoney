import type { Category, Transaction } from "./types"

type FlowRow = Pick<Transaction, "tagNames"> & Partial<Pick<Transaction, "excluded">>
type MoneyRow = FlowRow & Pick<Transaction, "amount" | "categoryId" | "categoryName"> & Partial<Pick<Transaction, "income">>

/** Whether a row has an IGNORE tag, case-insensitive. */
export function hasIgnoreTag(row: Pick<Transaction, "tagNames">): boolean {
  return row.tagNames.some((tag) => tag.toUpperCase() === "IGNORE")
}

/** Ordinary flows exclude excluded rows and IGNORE tags, but include holds. */
export function isOrdinaryFlow(row: FlowRow): boolean {
  return !row.excluded && !hasIgnoreTag(row)
}

/** Ids of the income categories: marked income, or under one that is. */
export function incomeCategoryIds(categories: Pick<Category, "id" | "parentId" | "income">[]): Set<number> {
  const marked = new Set(categories.filter((c) => c.income).map((c) => c.id))
  return new Set(categories.filter((c) => marked.has(c.id) || (c.parentId != null && marked.has(c.parentId))).map((c) => c.id))
}

/** No category yet: none at all, or the default (Uncategorised). */
export function isUncategorised(row: Pick<Transaction, "categoryId" | "categoryName">): boolean {
  return row.categoryId == null || row.categoryName === "Uncategorised"
}

/**
 * Spending: an ordinary row outside the income categories that is money out,
 * or money back into a spending category (a refund, or a payback you put in
 * one), which reduces it. Callers add `-amount`.
 */
export function isSpending(row: MoneyRow): boolean {
  return isOrdinaryFlow(row) && !row.income && (row.amount < 0 || (row.amount > 0 && !isUncategorised(row)))
}

/** Income: an ordinary row in an income category. Callers add `amount`. */
export function isIncome(row: MoneyRow): boolean {
  return isOrdinaryFlow(row) && !!row.income
}

/** Money in that is neither yet: ordinary, uncategorised, and positive.
 * It waits for a category, like uncategorised spending. */
export function isUnsortedIn(row: MoneyRow): boolean {
  return isOrdinaryFlow(row) && !row.income && row.amount > 0 && isUncategorised(row)
}

/** Whether a synced row is pending. */
export function isHeld(row: Pick<Transaction, "status">): boolean {
  return row.status === "HELD"
}
