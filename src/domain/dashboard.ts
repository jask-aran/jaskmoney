import type { Category, Transaction } from "./types"

export interface CategorySpend {
  categoryId: number | null
  name: string
  color: string
  amount: number // positive spend
  pct: number
}

/** Expense totals by category (debits only). Excludes IGNORE-tagged rows. */
export function computeCategorySpend(
  rows: Transaction[],
  categories: Category[],
): CategorySpend[] {
  const colorByName = new Map(categories.map((c) => [c.name, c.color]))
  const byKey = new Map<string, CategorySpend>()

  for (const r of rows) {
    if (r.excluded) continue
    if (r.tagNames.some((t) => t.toUpperCase() === "IGNORE")) continue
    if (r.amount >= 0) continue
    const name = r.categoryName || "Uncategorised"
    const key = `${r.categoryId ?? "null"}:${name}`
    const cur = byKey.get(key) ?? {
      categoryId: r.categoryId,
      name,
      color: colorByName.get(name) ?? "#7f849c",
      amount: 0,
      pct: 0,
    }
    cur.amount += -r.amount
    byKey.set(key, cur)
  }

  const list = [...byKey.values()].sort((a, b) => b.amount - a.amount)
  const total = list.reduce((s, x) => s + x.amount, 0)
  for (const item of list) {
    item.pct = total > 0 ? (item.amount / total) * 100 : 0
  }
  return list
}

export interface CategoryGroupSpend {
  name: string
  color: string
  amount: number
  pct: number
  /** Subcategories with spending, largest first; empty for a category that
   * has no group (e.g. Uncategorised). */
  children: CategorySpend[]
}

/** Roll category spend up into top-level groups (a category's parent, or the
 * category itself when it has none), largest group first. */
export function groupCategorySpend(list: CategorySpend[], categories: Category[]): CategoryGroupSpend[] {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const groups = new Map<string, CategoryGroupSpend>()
  const total = list.reduce((sum, item) => sum + item.amount, 0)
  for (const item of list) {
    const category = item.categoryId != null ? byId.get(item.categoryId) : undefined
    const parent = category?.parentId != null ? byId.get(category.parentId) : undefined
    const key = parent ? `p${parent.id}` : `c${item.categoryId ?? item.name}`
    const group = groups.get(key) ?? { name: parent?.name ?? item.name, color: parent?.color ?? item.color, amount: 0, pct: 0, children: [] }
    group.amount += item.amount
    if (parent) group.children.push(item)
    groups.set(key, group)
  }
  const out = [...groups.values()].sort((a, b) => b.amount - a.amount)
  for (const group of out) {
    group.pct = total > 0 ? (group.amount / total) * 100 : 0
    group.children.sort((a, b) => b.amount - a.amount)
  }
  return out
}

/** Whole dollars: "$1,478", "-$20". */
export function formatWholeMoney(n: number): string {
  const sign = n < 0 ? "-" : ""
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString("en-AU")}`
}

/** Daily debit totals between start/end inclusive. */
export function dailySpendSeries(
  rows: Transaction[],
  startISO: string,
  endISO: string,
): { dates: string[]; values: number[] } {
  const start = Date.parse(startISO + "T00:00:00")
  const end = Date.parse(endISO + "T00:00:00")
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return { dates: [], values: [] }
  }
  const days = Math.round((end - start) / 86400000) + 1
  const dates: string[] = []
  const values: number[] = []
  const map = new Map<string, number>()
  for (const r of rows) {
    if (r.excluded) continue
    if (r.tagNames.some((t) => t.toUpperCase() === "IGNORE")) continue
    if (r.amount >= 0) continue
    if (r.dateISO < startISO || r.dateISO > endISO) continue
    map.set(r.dateISO, (map.get(r.dateISO) ?? 0) + -r.amount)
  }
  for (let i = 0; i < days; i++) {
    // Step by calendar day, not 24h: a 25-hour DST day would repeat a date.
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    const iso = toISO(d)
    dates.push(iso)
    values.push(map.get(iso) ?? 0)
  }
  return { dates, values }
}

/** Running totals of `values`. */
export function cumulative(values: number[]): number[] {
  let sum = 0
  return values.map((v) => (sum += v))
}

/** Totals per Monday-start week; the first and last weeks may be partial
 * (their `days` say how many of `dates` they cover). */
export function weeklyTotals(dates: string[], values: number[]): Array<{ startISO: string; total: number; days: number }> {
  const weeks: Array<{ startISO: string; total: number; days: number }> = []
  dates.forEach((iso, i) => {
    const monday = (new Date(iso + "T12:00:00Z").getUTCDay() + 6) % 7 === 0
    if (monday || weeks.length === 0) weeks.push({ startISO: iso, total: 0, days: 0 })
    const week = weeks[weeks.length - 1]!
    week.total += values[i] ?? 0
    week.days++
  })
  return weeks
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function formatMoney(n: number): string {
  const sign = n < 0 ? "-" : ""
  const abs = Math.abs(n)
  return `${sign}$${abs.toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function formatPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—"
  return `${n.toFixed(1)}%`
}
