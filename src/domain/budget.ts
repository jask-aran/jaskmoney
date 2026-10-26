import type { Account, Category, Transaction } from "./types"

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
  void config, dateISO
  throw new Error("not implemented")
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
  /** spent / amount × 100. */
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
  void budgets, config, todayISO, accounts, categories, transactions
  throw new Error("not implemented")
}
