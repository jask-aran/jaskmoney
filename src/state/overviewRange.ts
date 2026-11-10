import { spendingScope } from "../domain/accountTree"
import { computeCategorySpend, fitCategoryLines, groupCategorySpend, type CategoryLine } from "../domain/dashboard"
import { appNow } from "../domain/days"
import { timeframeBounds } from "../domain/timeframe"
import type { CycleConfig } from "../domain/budget"
import type { Transaction } from "../domain/types"
import type { DataState } from "./dataStore"
import type { UiState } from "./uiStore"

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

function allCategoryLines(range: ReturnType<typeof overviewRange>): CategoryLine[] {
  return fitCategoryLines(range.groups, Number.MAX_SAFE_INTEGER)
}

export function overviewCategoryLines(range: ReturnType<typeof overviewRange>, open: number[] | null): CategoryLine[] {
  const all = allCategoryLines(range)
  if (!open) return all
  let shown = false
  return all.filter((line) => {
    if (!line.child) shown = line.categoryId != null && open.includes(line.categoryId)
    return !line.child || shown
  })
}

export function openGroups(prefs: { rangeText?: boolean }, u: Pick<UiState, "overviewOpen">): number[] | null {
  return prefs.rangeText ? null : u.overviewOpen
}
