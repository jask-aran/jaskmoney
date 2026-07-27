import type { Category, Transaction } from "./types"

export interface OverviewStats {
  balance: number
  debits: number
  credits: number
  txnCount: number
  uncatCount: number
  uncatTotal: number
  savingsRate: number | null
  dailyBurn: number | null
  runwayDays: number | null
}

export interface CategorySpend {
  categoryId: number | null
  name: string
  color: string
  amount: number // positive spend
  pct: number
}

/** Simple overview over already-scoped rows. */
export function computeOverview(rows: Transaction[]): OverviewStats {
  let balance = 0
  let debits = 0
  let credits = 0
  let uncatCount = 0
  let uncatTotal = 0
  let minISO = ""
  let maxISO = ""

  for (const r of rows) {
    balance += r.amount
    if (r.amount < 0) debits += -r.amount
    if (r.amount > 0) credits += r.amount
    if (!r.categoryId || r.categoryName === "Uncategorised") {
      uncatCount++
      uncatTotal += r.amount
    }
    if (!minISO || r.dateISO < minISO) minISO = r.dateISO
    if (!maxISO || r.dateISO > maxISO) maxISO = r.dateISO
  }

  const savingsRate = credits > 0 ? ((credits - debits) / credits) * 100 : null

  let dailyBurn: number | null = null
  let runwayDays: number | null = null
  if (minISO && maxISO && debits > 0) {
    const start = Date.parse(minISO + "T00:00:00")
    const end = Date.parse(maxISO + "T00:00:00")
    const days = Math.max(1, Math.round((end - start) / 86400000) + 1)
    dailyBurn = debits / days
    runwayDays =
      balance > 0 && dailyBurn > 0 ? balance / dailyBurn : balance <= 0 ? 0 : null
  }

  return {
    balance,
    debits,
    credits,
    txnCount: rows.length,
    uncatCount,
    uncatTotal,
    savingsRate,
    dailyBurn,
    runwayDays,
  }
}

/** Expense totals by category (debits only). Excludes IGNORE-tagged rows. */
export function computeCategorySpend(
  rows: Transaction[],
  categories: Category[],
): CategorySpend[] {
  const colorByName = new Map(categories.map((c) => [c.name, c.color]))
  const byKey = new Map<string, CategorySpend>()

  for (const r of rows) {
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
    if (r.tagNames.some((t) => t.toUpperCase() === "IGNORE")) continue
    if (r.amount >= 0) continue
    if (r.dateISO < startISO || r.dateISO > endISO) continue
    map.set(r.dateISO, (map.get(r.dateISO) ?? 0) + -r.amount)
  }
  for (let i = 0; i < days; i++) {
    const d = new Date(start + i * 86400000)
    const iso = toISO(d)
    dates.push(iso)
    values.push(map.get(iso) ?? 0)
  }
  return { dates, values }
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** Block sparkline (8 levels). Good enough until braille charts. */
export function sparkline(values: number[], width: number): string {
  if (width <= 0) return ""
  if (values.length === 0) return " ".repeat(width)
  const blocks = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]
  const max = Math.max(...values, 0)
  const out: string[] = []
  for (let x = 0; x < width; x++) {
    const idx = Math.floor((x / width) * values.length)
    const v = values[Math.min(idx, values.length - 1)] ?? 0
    if (max <= 0 || v <= 0) {
      out.push(blocks[0]!)
      continue
    }
    const level = Math.max(1, Math.round((v / max) * (blocks.length - 1)))
    out.push(blocks[level]!)
  }
  return out.join("")
}

export function barFill(pct: number, width: number): string {
  const w = Math.max(0, width)
  const filled = Math.round((Math.min(100, Math.max(0, pct)) / 100) * w)
  return "█".repeat(filled) + "░".repeat(Math.max(0, w - filled))
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

export function formatRunway(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—"
  return `${n.toFixed(1)} days`
}
