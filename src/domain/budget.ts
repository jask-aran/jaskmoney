import { scopeKey } from "./budgetScopes"
import { addDays, addMonthsClamped, dayOfWeek, daysBetween, MONTHS } from "./days"
import { isIncome, isSpending } from "./moneyRules"
import { accountRole, type Account, type Category, type Transaction } from "./types"

export type CycleUnit = "week" | "fortnight" | "month"

export type CycleAnchor = "calendar" | "date" | "weekStartNearDate"

export interface CycleConfig {
  unit: CycleUnit
  anchor: CycleAnchor
  anchorDate: string | null
  payEarly?: boolean
  paydays?: readonly string[]
}

export interface Cycle {
  start: string
  end: string
  days: number
}

const PAY_EARLY_DAYS: Record<CycleUnit, number> = { week: 2, fortnight: 5, month: 5 }

export function cycleFor(config: CycleConfig, dateISO: string): Cycle {
  const scheduled = scheduledCycle(config, dateISO)
  const finish = (start: string, next: string): Cycle => ({ start, end: addDays(next, -1), days: daysBetween(start, next) })
  const paydays = config.payEarly ? config.paydays ?? [] : []
  if (!paydays.length) return finish(scheduled.start, scheduled.next)
  const early = (start: string): string => {
    const from = addDays(start, -PAY_EARLY_DAYS[config.unit])
    return paydays.find((day) => day >= from && day < start) ?? start
  }
  const following = scheduledCycle(config, scheduled.next)
  if (early(scheduled.next) <= dateISO) return finish(early(scheduled.next), early(following.next))
  return finish(early(scheduled.start), early(scheduled.next))
}

export function paydays(transactions: Pick<Transaction, "dateISO" | "amount" | "categoryName" | "income" | "tagNames" | "excluded" | "categoryId">[]): string[] {
  return [...new Set(transactions.filter((t) => isIncome(t) && t.amount > 0 && t.categoryName === "Salary").map((t) => t.dateISO))].sort()
}

function scheduledCycle(config: CycleConfig, dateISO: string): { start: string; next: string } {
  if (config.anchor !== "calendar" && config.anchorDate === null) {
    throw new Error("budget cycle needs an anchor date")
  }
  const anchor = config.anchorDate ?? "1970-01-05"
  let start: string
  let next: string
  if (config.unit === "month") {
    const anchorDay = config.anchor === "calendar" ? "01" : anchor.slice(8, 10)
    const monthStart = (offset: number): string => {
      const month = Number(dateISO.slice(5, 7)) - 1 + offset
      const day = addMonthsClamped(`${dateISO.slice(0, 4)}-01-${anchorDay}`, month)
      return config.anchor === "weekStartNearDate" ? nearestMonday(day) : day
    }
    let offset = 0
    while (monthStart(offset) > dateISO) offset--
    while (monthStart(offset + 1) <= dateISO) offset++
    start = monthStart(offset)
    next = monthStart(offset + 1)
  } else {
    const days = config.unit === "week" ? 7 : 14
    const base = config.anchor === "calendar" ? "1970-01-05"
      : config.anchor === "weekStartNearDate" ? nearestMonday(anchor) : anchor
    start = addDays(base, Math.floor(daysBetween(base, dateISO) / days) * days)
    next = addDays(start, days)
  }
  return { start, next }
}

function nearestMonday(iso: string): string {
  const weekday = dayOfWeek(iso, "monday")
  return addDays(iso, weekday <= 3 ? -weekday : 7 - weekday)
}

export type BudgetScope =
  | { kind: "overall" }
  | { kind: "account"; accountId: number }
  | { kind: "category"; categoryId: number }

export interface BudgetHistoryEntry {
  scope: BudgetScope
  amount: number | null
  from: string | null
}

export function budgetIn(history: readonly BudgetHistoryEntry[], scope: BudgetScope, cycleStartISO: string): number | null {
  const key = scopeKey(scope)
  let current: BudgetHistoryEntry | undefined
  for (const entry of history) {
    if (scopeKey(entry.scope) !== key) continue
    if ((entry.from === null || entry.from <= cycleStartISO)
      && (!current || current.from === null || (entry.from !== null && entry.from >= current.from))) current = entry
  }
  return current?.amount ?? null
}

export function budgetsIn(history: readonly BudgetHistoryEntry[], budgets: Budget[], cycleStartISO: string): Budget[] {
  const scopes = new Map<string, { scope: BudgetScope; id: number }>()
  for (const b of budgets) scopes.set(scopeKey(b.scope), { scope: b.scope, id: b.id })
  for (const entry of history) if (!scopes.has(scopeKey(entry.scope))) scopes.set(scopeKey(entry.scope), { scope: entry.scope, id: -1 - scopes.size })
  return [...scopes.values()].flatMap(({ scope, id }) => {
    const amount = budgetIn(history, scope, cycleStartISO)
    return amount == null ? [] : [{ id, scope, amount }]
  })
}

export function cycleAt(config: CycleConfig, todayISO: string, offset: number): Cycle {
  let cycle = cycleFor(config, todayISO)
  for (let i = 0; i > offset; i--) cycle = cycleFor(config, addDays(cycle.start, -1))
  for (let i = 0; i < offset; i++) cycle = cycleFor(config, addDays(cycle.end, 1))
  return cycle
}

export interface Budget {
  id: number
  scope: BudgetScope
  amount: number
}

interface BudgetProgress {
  budget: Budget
  spent: number
  remaining: number
  usedPct: number
  daysLeft: number
  dailyAllowance: number
  projected: number
}

export function budgetIgnoredIds(categories: Category[]): Set<number> {
  const flagged = new Set(categories.filter((category) => category.budgetIgnored).map((category) => category.id))
  return new Set(categories.filter((category) => flagged.has(category.id)
    || (category.parentId !== null && flagged.has(category.parentId))).map((category) => category.id))
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

export type BudgetSubject = BudgetScope | { kind: "total" }

function budgetedCategoryIds(budgets: Budget[], categories: Category[]): Set<number> {
  const own = new Set(budgets.flatMap((b) => (b.scope.kind === "category" ? [b.scope.categoryId] : [])))
  return new Set(categories.filter((c) => own.has(c.id) || (c.parentId !== null && own.has(c.parentId))).map((c) => c.id))
}

export function budgetCounts(subject: BudgetSubject, categories: Category[], budgets: Budget[]): (row: Transaction) => boolean {
  if (subject.kind === "category") {
    const parents = new Map(categories.map((category) => [category.id, category.parentId]))
    return (row) => row.categoryId === subject.categoryId || (row.categoryId !== null && parents.get(row.categoryId) === subject.categoryId)
  }
  const ignored = budgetIgnoredIds(categories)
  const own = budgetedCategoryIds(budgets, categories)
  const kept = (row: Transaction) => row.categoryId === null || !ignored.has(row.categoryId)
  const owned = (row: Transaction) => row.categoryId !== null && own.has(row.categoryId)
  if (subject.kind === "total") return (row) => owned(row) || kept(row)
  if (subject.kind === "overall") return (row) => kept(row) && !owned(row)
  return (row) => kept(row) && row.accountId === subject.accountId
}

const startsByConfig = new WeakMap<CycleConfig, Map<string, string>>()
function cycleStarts(config: CycleConfig): Map<string, string> {
  let starts = startsByConfig.get(config)
  if (!starts) startsByConfig.set(config, starts = new Map())
  return starts
}

export function budgetCountsThen(subject: BudgetSubject, categories: Category[], history: readonly BudgetHistoryEntry[], budgets: Budget[], config: CycleConfig): (row: Transaction) => boolean {
  if (subject.kind === "category") return budgetCounts(subject, categories, budgets)
  const byCycle = new Map<string, (row: Transaction) => boolean>()
  const byDay = new Map<string, (row: Transaction) => boolean>()
  const starts = cycleStarts(config)
  return (row) => {
    let counts = byDay.get(row.dateISO)
    if (!counts) {
      let start = starts.get(row.dateISO)
      if (start === undefined) starts.set(row.dateISO, start = cycleFor(config, row.dateISO).start)
      counts = byCycle.get(start)
      if (!counts) byCycle.set(start, counts = budgetCounts(subject, categories, budgetsIn(history, budgets, start)))
      byDay.set(row.dateISO, counts)
    }
    return counts(row)
  }
}

export function allocation(budgets: Budget[], categories: Category[]): { overall: number | null; allocated: number; total: number; rest: number | null } {
  const overall = budgets.find((b) => b.scope.kind === "overall")?.amount ?? null
  const allocated = sum(topCategoryBudgets(budgets, categories).map((b) => b.amount))
  return { overall, allocated, total: overall ?? allocated, rest: overall == null ? null : overall - allocated }
}

export function measuredBudgets(budgets: Budget[], categories: Category[]): Budget[] {
  const { rest } = allocation(budgets, categories)
  return budgets.map((b) => (b.scope.kind === "overall" && rest != null ? { ...b, amount: Math.max(0, rest) } : b))
}

export function measuredBudgetIn(history: readonly BudgetHistoryEntry[], budgets: Budget[], categories: Category[], scope: BudgetScope, cycleStartISO: string): number | null {
  if (scope.kind !== "overall") return budgetIn(history, scope, cycleStartISO)
  const rest = allocation(budgetsIn(history, budgets, cycleStartISO).filter((b) => b.scope.kind !== "account"), categories).rest
  return rest == null ? null : Math.max(0, rest)
}

function topCategoryBudgets(budgets: Budget[], categories: Category[]): Budget[] {
  const onCategory = new Set(budgets.flatMap((b) => (b.scope.kind === "category" ? [b.scope.categoryId] : [])))
  return budgets.filter((b) => {
    if (b.scope.kind !== "category") return false
    const id = b.scope.categoryId
    const parent = categories.find((c) => c.id === id)?.parentId ?? null
    return parent === null || !onCategory.has(parent)
  })
}

export function totalBudgetIn(history: readonly BudgetHistoryEntry[], budgets: Budget[], categories: Category[], cycleStartISO: string): number | null {
  const then = budgetsIn(history, budgets, cycleStartISO).filter((b) => b.scope.kind !== "account")
  return then.length ? allocation(then, categories).total : null
}

export function progressOf(budget: Budget, spent: number, cycle: Cycle, todayISO: string): BudgetProgress {
  const daysLeft = daysBetween(todayISO, cycle.end) + 1
  const elapsed = daysBetween(cycle.start, todayISO) + 1
  const remaining = budget.amount - spent
  return {
    budget, spent, remaining, usedPct: budget.amount > 0 ? spent / budget.amount * 100 : spent > 0 ? Infinity : 0, daysLeft,
    dailyAllowance: remaining <= 0 ? 0 : remaining / daysLeft,
    projected: spent / elapsed * cycle.days,
  }
}

export function budgetProgress(
  budgets: Budget[],
  config: CycleConfig,
  todayISO: string,
  accounts: Account[],
  categories: Category[],
  transactions: Transaction[],
): BudgetProgress[] {
  const cycle = cycleFor(config, todayISO)
  const rows = cycleSpending(cycle, todayISO, accounts, transactions)
  return measuredBudgets(budgets, categories).map((budget) => {
    const counts = budgetCounts(budget.scope, categories, budgets)
    return progressOf(budget, rows.reduce((total, row) => (counts(row) ? total - row.amount : total), 0), cycle, todayISO)
  })
}

export function cycleSpending(cycle: Cycle, throughISO: string, accounts: Account[], transactions: Transaction[]): Transaction[] {
  const spendingIds = new Set(accounts.filter((a) => accountRole(a) === "spending").map((a) => a.id))
  return transactions.filter((row) => isSpending(row)
    && row.accountId !== null && spendingIds.has(row.accountId)
    && row.dateISO >= cycle.start && row.dateISO <= throughISO)
}

export function pastCycles(config: CycleConfig, todayISO: string, count: number): Cycle[] {
  const cycles: Cycle[] = []
  let cycle = cycleFor(config, todayISO)
  for (let i = 0; i < count; i++) {
    cycle = cycleFor(config, addDays(cycle.start, -1))
    cycles.push(cycle)
  }
  return cycles
}

export function spendByGroup(rows: Transaction[], categories: Category[]): Map<number | null, number> {
  const parents = new Map(categories.map((category) => [category.id, category.parentId]))
  const spend = new Map<number | null, number>()
  for (const row of rows) {
    const group = row.categoryId === null ? null : parents.get(row.categoryId) ?? row.categoryId
    spend.set(group, (spend.get(group) ?? 0) - row.amount)
  }
  return spend
}

export function describeCycle(config: CycleConfig): string {
  const from = scheduleText(config)
  return config.payEarly ? `${from}, or payday if pay comes first` : from
}

function scheduleText(config: CycleConfig): string {
  const every = config.unit === "week" ? "Weekly" : config.unit === "fortnight" ? "Fortnightly" : "Monthly"
  if (config.anchor === "calendar") return config.unit === "month" ? `${every} from the 1st` : `${every} from Monday`
  const date = config.anchorDate ?? ""
  const day = Number(date.slice(8, 10))
  const pretty = /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${day} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}` : date || "?"
  const when = config.unit === "month" ? `the ${ordinal(day)}` : pretty
  return config.anchor === "date" ? `${every} from ${when}` : `${every} from the Monday nearest ${when}`
}

function ordinal(n: number): string {
  if (!n) return "?"
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")
  return `${n}${s}`
}
