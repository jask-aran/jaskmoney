import { accountRole, type Account, type Category } from "./types"
import type { Budget, BudgetScope } from "./budget"

export interface BudgetScopeOption {
  key: string
  label: string
  scope: BudgetScope
}

export function scopeKey(scope: BudgetScope): string {
  return scope.kind === "overall" ? "overall" : scope.kind === "account" ? `account:${scope.accountId}` : `category:${scope.categoryId}`
}

/** What a budget can cover: overall spending, a spending account, or a
 * spending category (each group, then its subcategories, then the remaining
 * local categories). Not-spending categories are left out. */
export function budgetScopeOptions(accounts: Account[], categories: Category[]): BudgetScopeOption[] {
  const options: BudgetScopeOption[] = [{ key: "overall", label: "Overall spending", scope: { kind: "overall" } }]
  for (const a of accounts.filter((a) => accountRole(a) === "spending")) {
    options.push({ key: `account:${a.id}`, label: `Account · ${a.name}`, scope: { kind: "account", accountId: a.id } })
  }
  const spendable = categories.filter((c) => !c.notSpending)
  const groupIds = new Set(spendable.map((c) => c.parentId).filter((id): id is number => id != null))
  const category = (c: Category, label: string) => options.push({ key: `category:${c.id}`, label, scope: { kind: "category", categoryId: c.id } })
  for (const group of spendable.filter((c) => groupIds.has(c.id))) {
    category(group, group.name)
    for (const child of spendable.filter((c) => c.parentId === group.id)) category(child, `${group.name} › ${child.name}`)
  }
  for (const c of spendable.filter((c) => c.parentId == null && !groupIds.has(c.id))) category(c, c.name)
  return options
}

export function budgetLabel(budget: Budget, accounts: Account[], categories: Category[]): string {
  const scope = budget.scope
  if (scope.kind === "overall") return "Overall spending"
  if (scope.kind === "account") return `Account · ${accounts.find((a) => a.id === scope.accountId)?.name ?? "(removed)"}`
  const c = categories.find((x) => x.id === scope.categoryId)
  if (!c) return "(removed category)"
  const parent = c.parentId != null ? categories.find((x) => x.id === c.parentId) : undefined
  return parent ? `${parent.name} › ${c.name}` : c.name
}
