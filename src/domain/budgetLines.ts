import { scopeKey } from "./budgetScopes"
import { budgetsIn, cycleAt, cycleFor, cycleSpending, pastCycles, spendByGroup, type Budget, type BudgetHistoryEntry, type Cycle, type CycleConfig } from "./budget"
import type { Account, Category, Transaction } from "./types"
import type { BudgetStyle } from "./topUp"

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

/** The Budgets tab's Budgets card: with category budgets, their total
 * with the overall one first; the overall budget (everything else; shown
 * unset too), then account budgets, then category budgets in `categories`
 * order. */
export function budgetListRows(budgets: Budget[], categories: Category[]): ({ kind: "total"; budget: null } | { kind: "overall"; budget: Budget | null } | { kind: "account" | "category"; budget: Budget })[] {
  // A group, then the categories under it.
  const order = new Map(categories.map((c, i) => [c.id, i]))
  const place = ({ scope }: Budget) => {
    const c = scope.kind === "category" ? categories.find((x) => x.id === scope.categoryId) : undefined
    if (!c) return Infinity
    return c.parentId == null ? order.get(c.id)! * 1000 : (order.get(c.parentId) ?? 0) * 1000 + 1 + order.get(c.id)!
  }
  return [
    ...(budgets.some((b) => b.scope.kind === "category") ? [{ kind: "total" as const, budget: null }] : []),
    { kind: "overall", budget: budgets.find((b) => b.scope.kind === "overall") ?? null },
    ...budgets.filter((b) => b.scope.kind === "account").map((budget) => ({ kind: "account" as const, budget })),
    ...budgets.filter((b) => b.scope.kind === "category").sort((a, b) => place(a) - place(b)).map((budget) => ({ kind: "category" as const, budget })),
  ]
}

/** What the Budgets tab shows for the cycle `offset` from today's (0 this
 * one, -1 the one before): the cycle, the day it's shown up to (today, or
 * its last day once it's over), and the budgets in force in it. */
export function budgetView(config: CycleConfig, todayISO: string, offset: number, history: readonly BudgetHistoryEntry[], budgets: Budget[]): { cycle: Cycle; through: string; budgets: Budget[]; current: boolean } {
  const cycle = cycleAt(config, todayISO, Math.min(0, offset))
  const current = cycle.end >= todayISO
  return { cycle, through: current ? todayISO : cycle.end, budgets: current ? budgets : budgetsIn(history, budgets, cycle.start), current }
}

/** What arms a budget for deleting in the cycle `cycleStart`: its scope and
 * the cycle, as one id. */
export const budgetArmId = (budget: Budget, cycleStart: string) => `${scopeKey(budget.scope)}@${cycleStart}`

/** A row of the Budgets tab's Set budgets pane: the budget style, the
 * overall budget, then the categories, groups closed unless opened. */
export type SetupRow =
  | { kind: "style"; style: BudgetStyle }
  | { kind: "overall"; budget: Budget | null; name: string; average: number }
  | { kind: "line"; line: BudgetLine; open: boolean | null; budgeted: number }

/**
 * The Set budgets pane's rows: the overall budget (everything else once
 * categories have their own), with what it would start from, its average:
 * the counted groups' averages less what has a budget of its own. Then each
 * group of `lines`, its categories under it only when it's in `open`;
 * `open` on a group is null when it has no categories to show, and
 * `budgeted` counts the budgets inside it (seen while it's closed).
 */
export function budgetSetupRows(lines: BudgetLine[], budgets: Budget[], open: ReadonlySet<number>, ignored: ReadonlySet<number>, style: BudgetStyle = "tracking"): SetupRow[] {
  const hasCategoryBudgets = budgets.some((b) => b.scope.kind === "category")
  const groups: Array<{ group: BudgetLine; children: BudgetLine[] }> = []
  for (const l of lines) {
    if (!l.child || !groups.length) groups.push({ group: l, children: [] })
    else groups.at(-1)!.children.push(l)
  }
  const counted = (l: BudgetLine) => l.categoryId === null || !ignored.has(l.categoryId)
  const average = groups.reduce((sum, { group, children }) => {
    if (!counted(group) || group.budget) return sum
    return sum + group.average - children.filter((c) => c.budget || !counted(c)).reduce((n, c) => n + c.average, 0)
  }, 0)
  return [
    { kind: "style", style },
    { kind: "overall", budget: budgets.find((b) => b.scope.kind === "overall") ?? null, name: hasCategoryBudgets ? "Everything else" : "Overall spending", average },
    ...groups.flatMap(({ group, children }): SetupRow[] => {
      const isOpen = group.categoryId !== null && open.has(group.categoryId)
      return [
        { kind: "line", line: group, open: children.length ? isOpen : null, budgeted: children.filter((c) => c.budget).length },
        ...(isOpen ? children.map((line): SetupRow => ({ kind: "line", line, open: null, budgeted: 0 })) : []),
      ]
    }),
  ]
}
