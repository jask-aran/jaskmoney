import { spendingScope } from "../domain/accountTree"
import { computeCategorySpend, fitCategoryLines, groupCategorySpend, type CategoryLine } from "../domain/dashboard"
import { appNow } from "../domain/days"
import { timeframeBounds } from "../domain/timeframe"
import type { CycleConfig } from "../domain/budget"
import type { Transaction } from "../domain/types"
import type { DataState } from "./dataStore"
import type { UiState } from "./uiStore"

/**
 * What the Overview shows over its Date Range, computed once for the tab and
 * its keys alike: the bounds, the spending scope (the selected spending
 * account, or all of them), that scope's transactions in the range, and its
 * spending by category group.
 */
export function overviewRange(
  data: { state: Pick<DataState, "accounts" | "accountSelection" | "categories">; transactions(): Transaction[]; cycle(): CycleConfig },
  u: Pick<UiState, "timeframe">,
) {
  const d = data.state
  const clock = appNow()
  const bounds = timeframeBounds(u.timeframe, clock, data.cycle())
  const scope = spendingScope(d.accounts, d.accountSelection)
  const scopeIds = new Set(scope.accounts.map((a) => a.id))
  const spending = data.transactions().filter((t) => t.accountId != null && scopeIds.has(t.accountId))
  const inPeriod = spending.filter((t) => t.dateISO >= bounds.start && t.dateISO <= bounds.end)
  const groups = groupCategorySpend(computeCategorySpend(inPeriod, d.categories), d.categories)
  return { clock, bounds, scope, scopeIds, spending, inPeriod, groups }
}

/** Every category line, groups then their subcategories: what the
 * Categories card's cursor moves over. */
export function allCategoryLines(range: ReturnType<typeof overviewRange>): CategoryLine[] {
  return fitCategoryLines(range.groups, Number.MAX_SAFE_INTEGER)
}
