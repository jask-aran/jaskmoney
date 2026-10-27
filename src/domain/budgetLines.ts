import { cycleFor, cycleSpending, pastCycles, spendByGroup, type Budget, type CycleConfig } from "./budget"
import type { Account, Category, Transaction } from "./types"

/** One line of the Budgets tab's category list. */
export interface BudgetLine {
  /** null: uncategorised (it can't have a budget). */
  categoryId: number | null
  name: string
  color: string | null
  /** Spent this cycle so far. */
  now: number
  /** Average over the cycles before (up to `averageOver`, from the first data). */
  average: number
  /** The whole cycle before, or null before the first data. */
  last: number | null
  /** The category's budget, if it has one. */
  budget: Budget | null
  /** A category inside a group (drawn indented under it). */
  child: boolean
}

/**
 * This cycle's spending by category against the average of the cycles
 * before: each group with spending now or before (biggest now first), then
 * the categories in it the same way. Uncategorised is a group of its own.
 */
export function budgetCategoryLines(
  config: CycleConfig, todayISO: string, accounts: Account[], categories: Category[],
  budgets: Budget[], transactions: Transaction[], averageOver = 3,
): BudgetLine[] {
  const firstData = transactions.reduce((first, t) => (t.dateISO < first ? t.dateISO : first), todayISO)
  const cycle = cycleFor(config, todayISO)
  const before = pastCycles(config, todayISO, averageOver).filter((c) => c.end >= firstData)
  const nowRows = cycleSpending(cycle, todayISO, accounts, transactions)
  const beforeRows = before.map((c) => cycleSpending(c, c.end, accounts, transactions))
  const byCategory = (rows: Transaction[]) => {
    const spend = new Map<number | null, number>()
    for (const t of rows) spend.set(t.categoryId, (spend.get(t.categoryId) ?? 0) - t.amount)
    return spend
  }
  const groupNow = spendByGroup(nowRows, categories)
  const groupBefore = beforeRows.map((rows) => spendByGroup(rows, categories))
  const catNow = byCategory(nowRows)
  const catBefore = beforeRows.map(byCategory)
  const average = (maps: Map<number | null, number>[], id: number | null) => (maps.length ? maps.reduce((sum, m) => sum + (m.get(id) ?? 0), 0) / maps.length : 0)
  const budgetOf = new Map(budgets.flatMap((b) => (b.scope.kind === "category" ? [[b.scope.categoryId, b] as const] : [])))
  const line = (id: number | null, now: number, avg: number, last: number | null, child: boolean): BudgetLine => {
    const category = id === null ? undefined : categories.find((c) => c.id === id)
    return { categoryId: id, name: id === null ? "Uncategorised" : category?.name ?? "(removed)", color: category?.color ?? null, now, average: avg, last, budget: id === null ? null : budgetOf.get(id) ?? null, child }
  }
  const worth = (l: BudgetLine) => l.now >= 0.5 || l.average >= 0.5 || l.budget != null
  const order = (a: BudgetLine, b: BudgetLine) => b.now - a.now || b.average - a.average
  const ids = new Set([...groupNow.keys(), ...groupBefore.flatMap((m) => [...m.keys()]), ...[...budgetOf.keys()].map((id) => categories.find((c) => c.id === id)?.parentId ?? id)])
  const groups = [...ids].map((id) => line(id, groupNow.get(id) ?? 0, average(groupBefore, id), groupBefore[0] ? groupBefore[0].get(id) ?? 0 : null, false)).filter(worth).sort(order)
  return groups.flatMap((g) => [g, ...(g.categoryId === null ? [] : categories.filter((c) => c.parentId === g.categoryId)
    .map((c) => line(c.id, catNow.get(c.id) ?? 0, average(catBefore, c.id), catBefore[0] ? catBefore[0].get(c.id) ?? 0 : null, true)).filter(worth).sort(order))])
}

/**
 * How the category budgets add up against the overall one. Budgets on a
 * group and on categories inside it overlap (the group's covers them), so
 * a category's counts only when its group has none.
 */
export function allocation(budgets: Budget[], categories: Category[]): { overall: number | null; allocated: number } {
  const overall = budgets.find((b) => b.scope.kind === "overall")?.amount ?? null
  const onCategory = new Map(budgets.flatMap((b) => (b.scope.kind === "category" ? [[b.scope.categoryId, b.amount] as const] : [])))
  let allocated = 0
  for (const [id, amount] of onCategory) {
    const parent = categories.find((c) => c.id === id)?.parentId ?? null
    if (parent === null || !onCategory.has(parent)) allocated += amount
  }
  return { overall, allocated }
}

/** The Budgets tab's top card: the cycle, the overall budget (shown unset
 * too) and account budgets; category budgets are the Categories card's. */
export function budgetListRows(budgets: Budget[]): ({ kind: "cycle" } | { kind: "overall"; budget: Budget | null } | { kind: "account"; budget: Budget })[] {
  return [
    { kind: "cycle" },
    { kind: "overall", budget: budgets.find((b) => b.scope.kind === "overall") ?? null },
    ...budgets.filter((b) => b.scope.kind === "account").map((budget) => ({ kind: "account" as const, budget })),
  ]
}
