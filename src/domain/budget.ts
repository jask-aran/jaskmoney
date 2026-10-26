import { addDays, addMonthsClamped, daysBetween, MONTHS, weekdayIndex } from "./days"
import { isSpending } from "./moneyRules"
import { accountRole, type Account, type Category, type Transaction } from "./types"

/**
 * Budget cycles and progress.
 *
 * One cycle definition applies to every budget. No rollover: each cycle
 * starts fresh from its limit. Dates are "YYYY-MM-DD" calendar days; weeks
 * start on Monday.
 */

export type CycleUnit = "week" | "fortnight" | "month"

/**
 * How cycles line up:
 * - "calendar": weeks start Monday; fortnights are Monday-start fortnights
 *   counted from Monday 1970-01-05; months start on the 1st.
 * - "date": cycles start on `anchorDate` and repeat every unit. Monthly cycles
 *   start on the anchor's day of month, clamped to the month's last day (an
 *   anchor on the 31st starts on 30 Apr, 28/29 Feb).
 * - "weekStartNearDate": like "date", but each cycle start moves to the Monday
 *   nearest it (a Thursday start moves back to Monday, a Friday start forward to
 *   the next Monday; nearest = smallest day distance, ties go back). For weeks
 *   and fortnights this just shifts the anchor; for months each month's
 *   (clamped) start day is shifted independently.
 */
export type CycleAnchor = "calendar" | "date" | "weekStartNearDate"

export interface CycleConfig {
  unit: CycleUnit
  anchor: CycleAnchor
  /** Required for "date" and "weekStartNearDate"; ignored for "calendar". */
  anchorDate: string | null
}

export interface Cycle {
  /** First day, inclusive. */
  start: string
  /** Last day, inclusive. */
  end: string
  days: number
}

/** The cycle containing `dateISO` (dates before the anchor work too: cycles
 * extend backwards). Throws when the anchor needs a date and has none. */
export function cycleFor(config: CycleConfig, dateISO: string): Cycle {
  if (config.anchor !== "calendar" && config.anchorDate === null) {
    throw new Error("budget cycle needs an anchor date")
  }
  const anchor = config.anchorDate ?? "1970-01-05"
  let start: string
  let next: string
  if (config.unit === "month") {
    const anchorDay = config.anchor === "calendar" ? "01" : anchor.slice(8, 10)
    const monthStart = (offset: number): string => {
      // Start in January so an anchor on the 31st survives short months.
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
  return { start, end: addDays(next, -1), days: daysBetween(start, next) }
}

function nearestMonday(iso: string): string {
  const weekday = (weekdayIndex(iso) + 6) % 7
  return addDays(iso, weekday <= 3 ? -weekday : 7 - weekday)
}

/** What a budget limits. A category budget on a group covers its children. */
export type BudgetScope =
  | { kind: "overall" }
  | { kind: "account"; accountId: number }
  | { kind: "category"; categoryId: number }

export interface Budget {
  id: number
  scope: BudgetScope
  /** Limit per cycle, dollars. */
  amount: number
}

export interface BudgetProgress {
  budget: Budget
  /** Positive dollars spent in the cycle up to and including today. */
  spent: number
  /** amount − spent (negative when over). */
  remaining: number
  /** spent / amount × 100 (a $0 budget: Infinity once anything is spent, else 0). */
  usedPct: number
  /** Days from today to the cycle end, inclusive of today (≥ 1). */
  daysLeft: number
  /** remaining / daysLeft, or 0 when remaining ≤ 0. */
  dailyAllowance: number
  /** spent / elapsed days × cycle days, where elapsed = days from the cycle
   * start through today (≥ 1). */
  projected: number
}

/**
 * Progress of each budget in the cycle containing `todayISO`, in the given
 * order. Spending follows the app's shared rules: outflows (amount < 0) from
 * spending-role accounts (`accountRole`), never `excluded` rows, never rows
 * tagged IGNORE (case-insensitive), and only rows dated within the cycle and
 * on or before today. An account budget counts that account's spending; a
 * category budget counts rows whose category is the category or one of its
 * children (via `parentId`).
 */
export function budgetProgress(
  budgets: Budget[],
  config: CycleConfig,
  todayISO: string,
  accounts: Account[],
  categories: Category[],
  transactions: Transaction[],
): BudgetProgress[] {
  const cycle = cycleFor(config, todayISO)
  const spendingIds = new Set(accounts.filter((a) => accountRole(a) === "spending").map((a) => a.id))
  const parents = new Map(categories.map((category) => [category.id, category.parentId]))
  const rows = transactions.filter((row) => isSpending(row)
    && row.accountId !== null && spendingIds.has(row.accountId)
    && row.dateISO >= cycle.start && row.dateISO <= todayISO)
  const daysLeft = daysBetween(todayISO, cycle.end) + 1
  const elapsed = daysBetween(cycle.start, todayISO) + 1
  return budgets.map((budget) => {
    const scope = budget.scope
    const spent = rows.reduce((sum, row) => {
      const matches = scope.kind === "overall"
        || (scope.kind === "account" && row.accountId === scope.accountId)
        || (scope.kind === "category" && (row.categoryId === scope.categoryId
          || (row.categoryId !== null && parents.get(row.categoryId) === scope.categoryId)))
      return matches ? sum - row.amount : sum
    }, 0)
    const remaining = budget.amount - spent
    return {
      budget, spent, remaining, usedPct: budget.amount > 0 ? spent / budget.amount * 100 : spent > 0 ? Infinity : 0, daysLeft,
      dailyAllowance: remaining <= 0 ? 0 : remaining / daysLeft,
      projected: spent / elapsed * cycle.days,
    }
  })
}

/** "Monthly from the 1st", "Fortnightly from 16 Oct 2026", "Monthly from the Monday nearest the 15th". */
export function describeCycle(config: CycleConfig): string {
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
